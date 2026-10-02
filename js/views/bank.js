// Bank-fanen: koble banken på (Enable Banking, kun læseadgang), se saldo og posteringer,
// sammenlign med budgettet, forbrug pr. kategori, faste træk og varsler.
import { state, canEdit, lists, defaultVisibleTo, emit } from '../state.js';
import { esc, kr, fmtDate, fmtYm, openModal, toast, errorToast, confirmDialog, copyText, currentYm, isoDate, lsGet, lsSet } from '../ui.js';
import { dateToIndex, indexToYm, spendable } from '../calc.js';
import { helpBtn } from '../help.js';
import { isAppOwner } from '../config.js';
import {
  bankApi, appRedirect, watchBankAccounts, linkAccounts, setBudgetAccount, setVisibility, unlinkAccount,
  loadMonths, syncAccount, needsSync, takeCallback, rememberBudgetForBank, bankBudget, ADULTS, txRules, saveTxRule, renameAccount, acctLabel,
} from '../bank.js';
import { matchMonth, suggestions, tokens } from '../bankmatch.js';
import { CATEGORIES, CAT, categorize, spendByCategory, monthSummary, recurring, partyKeyOf } from '../categorize.js';
import { openItemModal } from './budget.js';

const SUBS = [
  { id: 'overview', label: 'Oversigt' },
  { id: 'spend', label: 'Forbrug' },
  { id: 'subs', label: 'Faste træk' },
  { id: 'tx', label: 'Posteringer' },
];
const ui = {
  budgetId: null, accounts: null, status: null, statusErr: null, statusLoading: false,
  ym: currentYm(), openCat: null, q: '',
  sub: 'overview', acc: '', from: null, to: null, quick: 'm1', ...lsGet('bb:bankUi', {}),
  syncing: new Set(), autoTried: new Set(), tx: new Map(),
};

function ensureWatch() {
  if (ui.budgetId === state.budgetId && state.unsubs['col:bank']) return;
  ui.budgetId = state.budgetId; ui.accounts = null; ui.tx.clear(); ui.autoTried.clear();
  const un = watchBankAccounts((rows) => {
    ui.accounts = rows;
    ui.tx.clear();
    emit();
    autoSync();
  }, (e) => { console.warn(e); ui.accounts = []; emit(); });
  state.unsubs['col:bank'] = { fn: un };
}

async function loadStatus(force = false) {
  if (ui.statusLoading || (ui.status && !force)) return;
  ui.statusLoading = true; ui.statusErr = null;
  try { ui.status = await bankApi('/status'); } catch (e) { ui.statusErr = e.message; }
  ui.statusLoading = false;
  emit();
}

async function autoSync() {
  for (const a of ui.accounts || []) {
    if (!needsSync(a) || ui.autoTried.has(a.id) || ui.syncing.has(a.id)) continue;
    ui.autoTried.add(a.id);
    doSync(a, true);
  }
}
async function doSync(a, quiet = false) {
  if (!a || ui.syncing.has(a.id)) return;
  ui.syncing.add(a.id); ui.autoTried.add(a.id); emit();
  try {
    const r = await syncAccount(a);
    ui.tx.clear();
    if (!quiet) toast(`${acctLabel(a)}: ${r.count} posteringer hentet`);
  } catch (e) {
    if (!quiet || e.status === 410) toast(`${acctLabel(a)}: ${e.message}`, 'error', 6000);
  } finally { ui.syncing.delete(a.id); emit(); }
}

const daysLeft = (iso) => (iso ? Math.ceil((new Date(iso) - Date.now()) / 864e5) : null);
const ago = (ms) => {
  if (!ms) return 'aldrig';
  const m = Math.round((Date.now() - (ms?.toMillis?.() ?? ms)) / 60000);
  if (m < 2) return 'lige nu';
  if (m < 60) return `for ${m} min. siden`;
  if (m < 48 * 60) return `for ${Math.round(m / 60)} timer siden`;
  return `for ${Math.round(m / 1440)} dage siden`;
};
const nowI = () => dateToIndex(new Date());
const lastMonths = (n) => Array.from({ length: n }, (_, k) => indexToYm(nowI() - k));
const knownKeys = () => (ui.accounts || []).map((x) => x.id);

/** Posteringer for nogle konti og måneder (cache + indlæsning i baggrunden). null = henter. */
function useTx(accounts, yms) {
  const key = `${accounts.map((a) => `${a.id}:${(a.months || []).length}:${a.syncedAt || ''}`).join(',')}|${yms.join(',')}`;
  if (!ui.tx.has(key)) {
    ui.tx.set(key, null);
    Promise.all(accounts.map((a) => loadMonths(a, yms).then((l) => l.map((t) => ({ ...t, acct: a.id })))))
      .then((ls) => { ui.tx.set(key, ls.flat().sort((a, b) => b.date.localeCompare(a.date))); emit(); })
      .catch((e) => { ui.tx.set(key, []); errorToast(e); });
  }
  return ui.tx.get(key);
}

// ---------- Husk valg (fane, konto, periode, hvad der er foldet sammen) ----------
const saveUi = () => lsSet('bb:bankUi', { sub: ui.sub, acc: ui.acc, quick: ui.quick, from: ui.quick ? null : ui.from, to: ui.quick ? null : ui.to });
const foldState = lsGet('bb:bankFold', {});
const isOpen = (id, def = true) => (id in foldState ? foldState[id] : def);
/** En kasse med pil, der kan foldes sammen. sum = kort tekst, der vises i overskriften. */
function fold(id, title, sum, body, def = true, cls = '') {
  return `<details class="glass card fold ${cls}" data-fold="${id}" ${isOpen(id, def) ? 'open' : ''}>
    <summary><span class="fold-title">${title}</span>${sum ? `<span class="fold-sum muted small">${sum}</span>` : ''}</summary>
    <div class="fold-body">${body}</div></details>`;
}
const selAccounts = () => (ui.acc ? ui.accounts.filter((a) => a.id === ui.acc) : ui.accounts);
const accName = (id) => acctLabel(ui.accounts?.find((a) => a.id === id));

export function render(root) {
  ensureWatch();
  loadStatus();
  const accounts = ui.accounts;
  if (!SUBS.some((x) => x.id === ui.sub)) ui.sub = 'overview';
  if (accounts && ui.acc && !accounts.some((a) => a.id === ui.acc)) ui.acc = '';
  const has = accounts && accounts.length > 0;
  const body = !has || ui.sub === 'overview' ? overviewHtml(accounts) : ui.sub === 'spend' ? spendHtml() : ui.sub === 'subs' ? subsHtml() : txHtml();
  const mine = accounts?.some((a) => a.owners?.includes(state.user.uid));
  root.innerHTML = `<div class="view-wrap bank-view">
    <section class="glass card bank-head">
      <h2>🏦 Bank ${helpBtn('bank')}</h2>
      ${has ? `<label class="bank-accsel"><span class="muted small">Viser</span><select id="bk-acc"><option value="">Alle konti (${accounts.length})</option>${accounts.map((a) => `<option value="${a.id}" ${a.id === ui.acc ? 'selected' : ''}>${esc(acctLabel(a))}</option>`).join('')}</select></label>` : ''}
      ${mine ? `<button class="btn small ghost" data-b="sync-all" title="Hent nyt fra banken" ${ui.syncing.size ? 'disabled' : ''}>${ui.syncing.size ? '⏳ Henter …' : '↻ Hent nyt'}</button>` : ''}
    </section>
    ${has ? `<nav class="subtabs glass bank-tabs">${SUBS.map((x) => `<button data-bsub="${x.id}" class="${x.id === ui.sub ? 'active' : ''}">${x.label}</button>`).join('')}</nav>` : ''}
    ${body}
  </div>`;
  bind(root);
}

// ---------- Oversigt ----------
function overviewHtml(accounts) {
  if (!accounts?.length) return `<section class="glass card"><p class="muted small">Saldo og posteringer hentes direkte fra banken. Appen kan <b>kun læse</b> — den kan aldrig flytte penge.</p>${statusHtml()}</section>${accountsHtml(accounts)}`;
  const planAcc = (ui.acc && accounts.find((a) => a.id === ui.acc)) || accounts.find((a) => a.budgetAccount) || accounts[0];
  const sess = ui.status?.sessions || [];
  const soon = sess.map((x) => daysLeft(x.validUntil)).filter((d) => d !== null).sort((x, y) => x - y)[0];
  const connSum = !ui.status ? 'tjekker …' : !sess.length ? 'ingen bank koblet på' : `${sess.map((x) => esc(x.bank)).join(', ')} · ${soon <= 14 ? `<span class="${soon <= 0 ? 'neg' : 'warn'}">${soon <= 0 ? 'udløbet' : `udløber om ${soon} dage`}</span>` : `gælder til ${fmtDate(sess.map((x) => x.validUntil).sort()[0])}`}`;
  return `${alertsHtml()}${accountsHtml(accounts)}${planHtml(planAcc)}
    ${fold('conn', '🔗 Forbindelse til banken', connSum, `<p class="muted small">Appen kan <b>kun læse</b> saldo og posteringer — den kan aldrig flytte penge.</p>${statusHtml()}`, !sess.length || soon <= 14)}`;
}

function alertsHtml() {
  const out = [];
  const li = (cls, act, html) => out.push(`<li class="${cls}"><button type="button" class="alert-btn" data-alert="${esc(act)}"><span>${html}</span><span class="go">›</span></button></li>`);
  for (const x of ui.status?.sessions || []) {
    const d = daysLeft(x.validUntil);
    if (d !== null && d <= 14) li(d <= 0 ? 'neg' : 'warn', 'conn', `🔑 ${d <= 0 ? `Adgangen til <b>${esc(x.bank)}</b> er udløbet` : `Adgangen til <b>${esc(x.bank)}</b> udløber om ${d} dage`} — forny med MitID.`);
  }
  const today = new Date();
  const seenAcc = new Set();
  for (const b of state.budget.settings?.balances || []) {
    if (b.source !== 'bank' || seenAcc.has(b.account)) continue;
    seenAcc.add(b.account);
    const sp = spendable(state.items, b.account, Number(b.amount) || 0, today);
    if (sp.missing > 0 && sp.missingDate && (sp.missingDate - today) / 864e5 <= 45) {
      li('neg', 'view:cashflow', `🔴 <b>${esc(b.account)}</b> mangler ${kr(sp.missing, false)} den ${fmtDate(sp.missingDate)}. Sæt penge ind inden da.`);
    }
  }
  const mapped = (ui.accounts || []).filter((a) => a.budgetAccount);
  const all = ui.accounts?.length ? useTx(ui.accounts, lastMonths(13)) : [];
  if (all) {
    const ym = currentYm();
    const rows = [];
    // Flere bankkonti kan høre til samme budgetkonto → de ses samlet
    for (const ba of [...new Set(mapped.map((a) => a.budgetAccount))]) {
      const ids = mapped.filter((a) => a.budgetAccount === ba).map((a) => a.id);
      const m = matchMonth(state.items, all.filter((t) => ids.includes(t.acct)), { account: ba, ym, knownKeys: knownKeys() });
      rows.push(...m.rows.filter((r) => r.status === 'diff' || r.status === 'missing'));
    }
    for (const r of rows.slice(0, 6)) {
      if (r.status === 'diff') li('warn', `item:${r.item.id}`, `⚠️ <b>${esc(r.item.name)}</b>: ${r.amount < 0 ? 'trukket' : 'kom ind med'} ${kr(Math.abs(r.tx.amount), false)} den ${fmtDate(r.tx.date)} — i budgettet står ${kr(Math.abs(r.amount), false)}.`);
      else li('warn', `item:${r.item.id}`, `❌ <b>${esc(r.item.name)}</b> (${kr(Math.abs(r.amount), false)}) er ikke fundet i banken — skulle ${r.amount < 0 ? 'trækkes' : 'komme'} den ${fmtDate(r.date)}.`);
    }
    if (rows.length > 6) li('warn', 'plan', `… og ${rows.length - 6} mere. Se "Plan og virkelighed".`);
    const rises = recurring(all, knownKeys()).filter((r) => r.change > 0 && !r.stale && (today - new Date(r.last)) / 864e5 <= 60);
    for (const r of rises.slice(0, 3)) li('warn', 'sub:subs', `📈 <b>${esc(r.name)}</b> er steget fra ${kr(r.prevAmount, false)} til ${kr(r.amount, false)}`);
  }
  if (!out.length) return '';
  return fold('alerts', '🔔 Det skal du være opmærksom på', `${out.length} ${out.length === 1 ? 'ting' : 'ting'}`, `<ul class="alert-list">${out.join('')}</ul><p class="muted small">Tryk på en linje for at hoppe hen til den.</p>`, true, 'alerts');
}

function statusHtml() {
  const s = ui.status;
  if (ui.statusErr) return `<div class="hint warn">Kunne ikke tjekke bankforbindelsen: ${esc(ui.statusErr)} <button class="btn small ghost" data-b="retry">Prøv igen</button></div>`;
  if (!s) return '<p class="muted small">Tjekker din bankforbindelse …</p>';
  if (!s.workerReady) {
    return `<div class="hint warn">Bankforbindelse er ikke slået til på serveren endnu.
      ${isAppOwner(state.user) ? '<br><b>Til dig som ejer:</b> Tilføj en <i>Secret</i> med navnet <code>BANK_SECRET</code> (en lang tilfældig tekst, mindst 32 tegn) på din Cloudflare Worker. Se guiden.' : '<br>Bed den, der har sat appen op, om at slå det til.'}</div>`;
  }
  if (!s.configured) {
    return `<div class="bank-cta">
      <div><b>Kobl din bank på</b><p class="muted small">Du skal bruge ca. 10 minutter og MitID. Det er gratis. Du opretter din egen gratis konto hos Enable Banking, som er den godkendte mellemmand, der henter dataene fra banken.</p></div>
      <button class="btn primary" data-b="setup">Start guiden</button></div>`;
  }
  const sess = s.sessions || [];
  return `<div class="bank-sessions">
    ${sess.length ? sess.map((x) => {
      const d = daysLeft(x.validUntil);
      const cls = d === null ? '' : d <= 0 ? 'neg' : d <= 14 ? 'warn' : '';
      return `<div class="bank-sess ${cls}">
        <div><b>🏦 ${esc(x.bank)}</b><span class="muted small"> · ${x.accounts.length} konti</span>
          <div class="small ${cls}">${d === null ? '' : d <= 0 ? '🔴 Adgangen er udløbet — log ind med MitID igen' : `${d <= 14 ? '🟡 ' : ''}Adgangen gælder til ${fmtDate(x.validUntil)} (om ${d} dage)`}</div></div>
        <span class="btn-row"><button class="btn small ${d !== null && d <= 14 ? 'primary' : 'ghost'}" data-b="renew" data-bank="${esc(x.bank)}" data-country="${esc(x.country)}">${d !== null && d <= 0 ? 'Log ind igen' : 'Forny'}</button>
        <button class="btn small danger-ghost" data-b="end" data-id="${esc(x.id)}" data-bank="${esc(x.bank)}">Afbryd</button></span>
      </div>`;
    }).join('') : '<p class="muted small">Din nøgle er sat ind. Nu mangler du bare at koble en bank på.</p>'}
    <div class="btn-row"><button class="btn primary small" data-b="connect">＋ Kobl bank på</button>
      <button class="btn ghost small" data-b="key">🔑 Min nøgle</button></div>
  </div>`;
}

function accountsHtml(accounts) {
  if (!accounts) return '<section class="glass card"><p class="muted">Henter bankkonti …</p></section>';
  if (!accounts.length) return '';
  const me = state.user.uid;
  const L = lists();
  const total = accounts.reduce((x, a) => x + (a.balance || 0), 0);
  const rows = accounts.map((a) => {
    const owner = a.owners?.includes(me);
    const joint = (a.owners || []).length > 1;
    const names = Object.values(a.ownerNames || {}).join(' og ');
    const shareAdults = (a.visibleTo || []).includes(ADULTS);
    const d = daysLeft(a.linked?.[me]?.validUntil);
    const credit = a.available != null && a.balance != null && a.available - a.balance > 1;
    return `<details class="acct-row ${a.id === ui.acc ? 'sel' : ''}" data-fold="acct:${a.id}" ${isOpen(`acct:${a.id}`, false) ? 'open' : ''}>
      <summary>
        <span class="ar-name"><b>${esc(acctLabel(a))}</b>${joint ? ' <span class="chip ok" title="Begge har koblet den samme konto på">👨‍👩‍👧</span>' : ''}${!a.budgetAccount ? ' <span class="chip warn">ikke i budgettet</span>' : ''}
          <small class="muted">${ui.syncing.has(a.id) ? '⏳ henter …' : esc(a.masked || '')}</small></span>
        <span class="ar-bal">${a.balance == null ? '–' : kr(a.balance)}</span>
      </summary>
      <div class="ar-body">
        <p class="muted small">${esc(a.bank || '')} ${esc(a.masked || '')} · bankens navn: ${esc(a.name || '–')} · hentet ${ago(a.syncedAt)} · koblet på af ${esc(names)}${owner && d !== null && d <= 14 ? ` · <span class="${d <= 0 ? 'neg' : 'warn'}">${d <= 0 ? 'adgangen er udløbet' : `adgangen udløber om ${d} dage`}</span>` : ''}</p>
        ${credit ? `<p class="muted small">💳 Disponibelt: <b>${kr(a.available, false)}</b> — det er saldoen plus den kredit (kassekredit), banken har givet på kontoen.</p>` : ''}
        <div class="ba-fields">
          ${owner ? `<label>Dit navn til kontoen<input data-rename="${a.id}" value="${esc(a.label || '')}" placeholder="${esc(acctLabel({ ...a, label: '' }))}" maxlength="40" autocomplete="off"></label>` : ''}
          <label>Hører til i budgettet
            <select data-map="${a.id}" ${canEdit() ? '' : 'disabled'}><option value="">— ingen —</option>${[...new Set([...L.accounts, a.budgetAccount].filter(Boolean))].map((x) => `<option ${x === a.budgetAccount ? 'selected' : ''}>${esc(x)}</option>`).join('')}</select></label>
          ${owner ? `<label>Hvem må se den?
            <select data-vis="${a.id}"><option value="owners" ${shareAdults ? '' : 'selected'}>${joint ? 'Kun os der ejer kontoen' : 'Kun mig'}</option><option value="adults" ${shareAdults ? 'selected' : ''}>Alle voksne i budgettet</option></select></label>` : ''}
        </div>
        <div class="btn-row">
          <button class="btn small ghost" data-pick="${a.id}">Vis kun denne konto</button>
          ${owner ? `<button class="btn small ghost" data-sync="${a.id}" ${ui.syncing.has(a.id) ? 'disabled' : ''}>↻ Hent nyt</button>
          <button class="btn small danger-ghost" data-unlink="${a.id}">Fjern</button>` : ''}
        </div>
      </div>
    </details>`;
  }).join('');
  return fold('accts', '💳 Bankkonti', `${accounts.length} konti · ${kr(total, false)} i alt`, `<div class="acct-list">${rows}</div><p class="muted small">Tryk på en konto for at give den et navn, vælge hvor den hører til i budgettet, og hvem der må se den.</p>`);
}

function monthsAround(ym) {
  const i = dateToIndex(new Date(`${ym}-15`));
  return [indexToYm(i - 1), ym, indexToYm(i + 1)];
}

function txRow(t, { showAcc = false, rules = txRules() } = {}) {
  const internal = t.partyKey && knownKeys().includes(t.partyKey);
  const cat = CAT[categorize(t, rules, knownKeys())];
  const cls = internal ? 'int' : t.amount < 0 ? 'neg' : 'pos';
  const me = (ui.accounts?.find((a) => a.id === t.acct)?.name || '').toLowerCase();
  const showParty = t.party && t.text && !t.text.toLowerCase().includes(t.party.toLowerCase()) && !(me && me.includes(t.party.toLowerCase()));
  return `<li><span class="tx-date">${fmtDate(t.date).replace(/ \d{4}$/, '')}</span>
    <span class="tx-text">${esc(t.text || t.party || '—')}${showParty ? `<small>${esc(t.party)}</small>` : ''}
      <span class="tx-tags">${internal ? '<span class="chip int">↔️ mellem egne konti</span>' : `<button type="button" class="chip cat-chip" data-tx-cat="${esc(t.id)}" data-tx-acct="${esc(t.acct || '')}" title="Skift kategori">${cat.icon} ${esc(cat.name)}</button>`}${showAcc && t.acct ? `<span class="chip">${esc(accName(t.acct))}</span>` : ''}${t.status && t.status !== 'BOOK' ? '<span class="chip warn">venter</span>' : ''}</span></span>
    <span class="tx-amt ${cls}">${t.amount < 0 ? '−' : '+'}${kr(Math.abs(t.amount), false)}</span></li>`;
}

function planHtml(a) {
  const yms = lastMonths(3);
  if (!yms.includes(ui.ym)) ui.ym = yms[0];
  // Alle bankkonti, der hører til samme konto i budgettet, ses samlet
  const group = a.budgetAccount ? ui.accounts.filter((x) => x.budgetAccount === a.budgetAccount) : [a];
  const title = a.budgetAccount ? esc(a.budgetAccount) : esc(acctLabel(a));
  const all = useTx(group, [...new Set([...monthsAround(ui.ym), ...lastMonths(4)])]);
  const chips = `<div class="av-chips">${yms.map((ym) => `<button class="av-chip ${ym === ui.ym ? 'on' : ''}" data-ym="${ym}">${fmtYm(ym, true)}</button>`).join('')}</div>`;
  if (!all) return fold('plan', `📋 Plan og virkelighed · ${title}`, '', `${chips}<p class="muted">Henter posteringer …</p>`);
  const kk = knownKeys();
  let plan = '', sumTxt = '';
  if (!a.budgetAccount) {
    plan = `<div class="hint">💡 <b>${esc(acctLabel(a))}</b> hører ikke til en konto i budgettet endnu. Tryk på kontoen under "Bankkonti" og vælg, hvor den hører til — så kan appen sammenligne budgettet med det, der faktisk er sket.</div>`;
  } else {
    const around = all.filter((t) => monthsAround(ui.ym).includes(t.date.slice(0, 7)));
    const m = matchMonth(state.items, around, { account: a.budgetAccount, ym: ui.ym, knownKeys: kk });
    const ICON = { ok: '✅', diff: '⚠️', late: '⏳', missing: '❌', pending: '🕒' };
    const rowTxt = (r) => {
      const exp = r.amount < 0;
      if (r.status === 'ok') return `${exp ? 'Trukket' : 'Kom ind'} ${fmtDate(r.tx.date)} som planlagt`;
      if (r.status === 'diff') {
        const more = exp ? r.diff < 0 : r.diff > 0;
        return `${exp ? (more ? 'Dyrere' : 'Billigere') : (more ? 'Mere' : 'Mindre')} end planlagt: <b>${kr(Math.abs(r.diff), false)}</b> ${exp ? (more ? 'mere' : 'mindre') : ''} · ${fmtDate(r.tx.date)}`;
      }
      if (r.status === 'late') return `Ikke set endnu — skulle ${exp ? 'trækkes' : 'komme'} den ${fmtDate(r.date)}`;
      if (r.status === 'missing') return `Ikke fundet i banken (skulle ${exp ? 'trækkes' : 'komme'} den ${fmtDate(r.date)})`;
      return `${exp ? 'Trækkes' : 'Kommer'} den ${fmtDate(r.date)}`;
    };
    const problems = m.rows.filter((r) => r.status === 'diff' || r.status === 'missing').length;
    sumTxt = problems ? `⚠️ ${problems} passer ikke` : m.rows.length ? '✅ passer' : '';
    plan = `
      <div class="pv-sum">
        <div><span class="muted small">Planlagt ud</span><b>${kr(m.planned.out, false)}</b></div>
        <div><span class="muted small">Faktisk ud</span><b class="${m.actual.out > m.planned.out + 1 ? 'neg' : ''}">${kr(m.actual.out, false)}</b></div>
        <div><span class="muted small">Planlagt ind</span><b>${kr(m.planned.in, false)}</b></div>
        <div><span class="muted small">Faktisk ind</span><b class="${m.actual.in + 1 < m.planned.in ? 'warn' : 'pos'}">${kr(m.actual.in, false)}</b></div>
      </div>
      <p class="small">${problems ? `⚠️ ${problems} ting passer ikke med budgettet i ${fmtYm(ui.ym, true)}.` : m.rows.length ? '✅ Alt, der er sket indtil nu, passer med budgettet.' : 'Ingen poster i budgettet på denne konto i måneden.'}</p>
      <ul class="pv-list">${m.rows.map((r) => `<li class="pv-${r.status}"><button type="button" class="pv-btn" data-open-item="${esc(r.item.id)}" title="Åbn posten">
        <span class="pv-ico">${ICON[r.status]}</span>
        <span class="pv-main"><b>${esc(r.item.name)}</b><small>${rowTxt(r)}</small></span>
        <span class="pv-amt">${kr(Math.abs(r.amount), false)}${r.tx && r.status === 'diff' ? `<small>faktisk ${kr(Math.abs(r.tx.amount), false)}</small>` : ''}</span></button></li>`).join('')}</ul>
      ${m.unplanned.length ? `<details class="pv-more"><summary>Ikke i budgettet i ${fmtYm(ui.ym, true)} (${m.unplanned.length})</summary>
        <ul class="tx-list">${m.unplanned.slice(0, 40).map((t) => txRow(t)).join('')}</ul></details>` : ''}
      ${m.internal.length ? `<p class="muted small">↔️ ${m.internal.length} overførsel${m.internal.length === 1 ? '' : 'er'} mellem jeres egne konti er genkendt og tæller ikke som udgift.</p>` : ''}`;
    const sug = ui.ym === yms[0] ? suggestions(state.items, all, { account: a.budgetAccount, knownKeys: kk }) : [];
    if (sug.length && canEdit()) {
      plan += `<div class="pv-sug"><h3>❓ Faste betalinger, der ikke står i budgettet</h3>
        <ul class="pv-list">${sug.map((x, i) => `<li class="plain"><span class="pv-ico">🔁</span><span class="pv-main"><b>${esc(x.name)}</b><small>set i ${x.seen} måneder · omkring den ${x.day}.</small></span>
          <span class="pv-amt">${kr(x.amount, false)}<button class="btn small ghost" data-sug="${i}">＋ Tilføj</button></span></li>`).join('')}</ul></div>`;
      ui.sug = sug;
    }
  }
  return fold('plan', `📋 Plan og virkelighed · ${title} ${helpBtn('bankPlan')}`, sumTxt, `${ui.acc ? '' : '<p class="muted small">Vælg en anden konto øverst for at se dens plan.</p>'}${chips}${plan}`, true, 'bank-plan');
}

// ---------- Periode (fælles for Forbrug og Posteringer) ----------
const QUICK = [
  { id: 'm1', label: 'Denne måned', range: () => [`${currentYm()}-01`, isoDate()] },
  { id: 'm-1', label: 'Sidste måned', range: () => { const ym = indexToYm(nowI() - 1); return [`${ym}-01`, isoDate(new Date(Number(ym.slice(0, 4)), Number(ym.slice(5)), 0))]; } },
  { id: 'm3', label: '3 mdr.', range: () => [isoDate(new Date(Date.now() - 91 * 864e5)), isoDate()] },
  { id: 'y', label: 'I år', range: () => [`${new Date().getFullYear()}-01-01`, isoDate()] },
  { id: 'm12', label: '12 mdr.', range: () => [isoDate(new Date(Date.now() - 365 * 864e5)), isoDate()] },
];
function ensurePeriod() {
  const q0 = QUICK.find((x) => x.id === ui.quick);
  if (q0) [ui.from, ui.to] = q0.range();
  else if (!ui.from || !ui.to) { ui.quick = 'm1'; [ui.from, ui.to] = QUICK[0].range(); }
}
const toD = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const ymsBetween = (from, to) => { const out = []; const fi = dateToIndex(toD(from)), ti = dateToIndex(toD(to)); for (let k = Math.max(fi, ti - 36); k <= ti; k++) out.push(indexToYm(k)); return out; };
const periodLabel = () => (QUICK.find((x) => x.id === ui.quick)?.label.toLowerCase() || `${fmtDate(ui.from)} – ${fmtDate(ui.to)}`);
function periodCtrl() {
  return `<div class="av-chips">${QUICK.map((x) => `<button class="av-chip ${ui.quick === x.id ? 'on' : ''}" data-quick="${x.id}">${x.label}</button>`).join('')}</div>
    <form class="period-form" id="bk-period">
      <label>Fra<input type="date" name="from" value="${esc(ui.from)}" required></label>
      <label>Til<input type="date" name="to" value="${esc(ui.to)}" required></label>
      <button class="btn small primary" type="submit">Vis perioden</button>
    </form>`;
}
function dataFromNote(accs) {
  const oldest = accs.map((a) => a.dataFrom).filter(Boolean).sort()[0];
  return oldest && oldest > ui.from ? `<p class="muted small">📅 Banken har kun givet posteringer tilbage til <b>${fmtDate(oldest)}</b>.</p>` : '';
}

// ---------- Forbrug pr. kategori ----------
function spendHtml() {
  ensurePeriod();
  const accs = selAccounts();
  const days = Math.round((toD(ui.to) - toD(ui.from)) / 864e5) + 1;
  const pTo = isoDate(new Date(toD(ui.from).getTime() - 864e5));
  const pFrom = isoDate(new Date(toD(ui.from).getTime() - days * 864e5));
  const all = useTx(accs, ymsBetween(pFrom, ui.to));
  const head = `<div class="section-head"><h2>Forbrug pr. kategori ${helpBtn('bankSpend')}</h2><span class="muted small">${ui.acc ? esc(accName(ui.acc)) : 'alle konti'}</span></div>${periodCtrl()}`;
  if (!all) return `<section class="glass card">${head}<p class="muted">Henter posteringer …</p></section>`;
  const rules = txRules();
  const kk = knownKeys();
  const curTx = all.filter((t) => t.date >= ui.from && t.date <= ui.to);
  const cur = spendByCategory(curTx, rules, kk);
  const prev = spendByCategory(all.filter((t) => t.date >= pFrom && t.date <= pTo), rules, kk);
  const sm = monthSummary(cur, prev);
  const pm = Object.fromEntries(prev.map((x) => [x.id, x.amount]));
  const max = Math.max(1, ...cur.map((x) => x.amount));
  const inn = curTx.filter((t) => t.amount > 0 && !(t.partyKey && kk.includes(t.partyKey))).reduce((s2, t) => s2 + t.amount, 0);
  const summary = cur.length ? `<p class="spend-summary">I perioden (${esc(periodLabel())}) brugte I <b>${kr(sm.total, false)}</b>${prev.length ? ` — ${sm.total > sm.prevTotal ? `${kr(sm.total - sm.prevTotal, false)} mere` : `${kr(sm.prevTotal - sm.total, false)} mindre`} end i de ${days} dage før` : ''}. Mest på <b>${esc(CAT[sm.top.id].name.toLowerCase())}</b> (${kr(sm.top.amount, false)}).
      ${sm.changes.length ? `<br><span class="muted small">Største ændringer: ${sm.changes.map((c) => `${CAT[c.id].icon} ${esc(CAT[c.id].name)} ${c.diff > 0 ? '+' : '−'}${kr(Math.abs(c.diff), false)}`).join(' · ')}</span>` : ''}</p>` : '';
  return `<section class="glass card spend">
    ${head}
    ${summary}
    <div class="pv-sum two"><div><span class="muted small">Brugt</span><b>−${kr(sm.total, false)}</b></div><div><span class="muted small">Kommet ind</span><b class="pos">+${kr(inn, false)}</b></div></div>
    ${dataFromNote(accs)}
    ${cur.length ? `<ul class="cat-bars">${cur.map((c) => {
      const d = c.amount - (pm[c.id] || 0);
      const open = ui.openCat === c.id;
      return `<li class="${open ? 'open' : ''}"><button type="button" class="cat-row" data-open-cat="${c.id}">
          <span class="cb-name">${CAT[c.id].icon} ${esc(CAT[c.id].name)}</span>
          <span class="cb-amt">${kr(c.amount, false)}${prev.length && Math.abs(d) >= 50 ? `<small class="${d > 0 ? 'neg' : 'pos'}">${d > 0 ? '↑' : '↓'} ${kr(Math.abs(d), false)}</small>` : ''}</span>
          <span class="cb-bar"><i style="width:${Math.max(2, (c.amount / max) * 100).toFixed(1)}%"></i></span></button>
        ${open ? `<ul class="tx-list">${curTx.filter((t) => t.amount < 0 && categorize(t, rules, kk) === c.id).map((t) => txRow(t, { rules, showAcc: !ui.acc && ui.accounts.length > 1 })).join('')}</ul>` : ''}</li>`;
    }).join('')}</ul>` : '<p class="muted">Ingen udgifter i perioden.</p>'}
    <p class="muted small">Kategorierne sættes automatisk ud fra butikkens navn. Er en forkert, så tryk på den — så husker appen det for alle posteringer fra samme sted.</p>
  </section>`;
}

// ---------- Faste træk / abonnementer ----------
function subsHtml() {
  const all = useTx(selAccounts(), lastMonths(13));
  const where = `<span class="muted small">${ui.acc ? esc(accName(ui.acc)) : 'alle konti'} · de sidste 12 mdr.</span>`;
  if (!all) return `<section class="glass card"><div class="section-head"><h2>Faste træk</h2>${where}</div><p class="muted">Henter posteringer …</p></section>`;
  const list = recurring(all, knownKeys());
  const active = list.filter((r) => !r.stale);
  const itemTok = state.items.map((it) => tokens(`${it.name} ${it.supplier || ''}`));
  const inBudget = (r) => { const t = tokens(r.key); return itemTok.some((it) => [...t].some((x) => it.has(x))); };
  const FREQ = { 1: 'hver måned', 3: 'hvert kvartal', 6: 'hvert halve år', 12: 'hvert år' };
  const total = active.reduce((s2, r) => s2 + r.monthly, 0);
  ui.subs = list;
  return `<section class="glass card">
    <div class="section-head"><h2>Faste træk og abonnementer ${helpBtn('bankSubs')}</h2>${where}</div>
    ${active.length ? `<p class="spend-summary">I har <b>${active.length}</b> faste træk, der tilsammen koster ca. <b>${kr(total, false)} om måneden</b> (${kr(total * 12, false)} om året).</p>` : '<p class="muted">Appen har ikke fundet faste træk endnu. Der skal typisk bruges 2–3 måneders posteringer.</p>'}
    <ul class="pv-list subs-list">${list.map((r, i) => `<li class="plain ${r.stale ? 'stale' : ''}">
      <span class="pv-ico">${r.change > 0 ? '📈' : r.change < 0 ? '📉' : '🔁'}</span>
      <span class="pv-main"><b>${esc(r.name)}</b><small>${FREQ[r.freq]} · sidst ${fmtDate(r.last)}${r.stale ? ' · ser ud til at være stoppet' : ''}${r.change ? ` · <span class="${r.change > 0 ? 'neg' : 'pos'}">${r.change > 0 ? 'steget' : 'faldet'} fra ${kr(r.prevAmount, false)}</span>` : ''}</small></span>
      <span class="pv-amt">${kr(r.amount, false)}${r.freq > 1 ? `<small>= ${kr(r.monthly, false)}/md.</small>` : ''}
        ${inBudget(r) ? '<small class="pos">✓ i budgettet</small>' : canEdit() && !r.stale ? `<button class="btn small ghost" data-add-sub="${i}">＋ Til budget</button>` : ''}</span></li>`).join('')}</ul>
  </section>`;
}

// ---------- Posteringer: periode og søgning ----------
function txHtml() {
  ensurePeriod();
  const accs = selAccounts();
  const all = useTx(accs, ymsBetween(ui.from, ui.to));
  const ctrl = `${periodCtrl()}
    <input id="bk-q" type="search" placeholder="Søg, fx Netto, MobilePay eller 129" value="${esc(ui.q)}" autocomplete="off" enterkeyhint="search">`;
  const head = (n) => `<div class="section-head"><h2>Posteringer</h2><span class="muted small">${ui.acc ? esc(accName(ui.acc)) : 'alle konti'}${n == null ? '' : ` · ${n} stk.`}</span></div>`;
  if (!all) return `<section class="glass card">${head()}${ctrl}<p class="muted">Henter posteringer …</p></section>`;
  const q = ui.q.trim().toLowerCase();
  const rules = txRules();
  const kk = knownKeys();
  const list = all.filter((t) => t.date >= ui.from && t.date <= ui.to)
    .filter((t) => !q || `${t.text} ${t.party} ${CAT[categorize(t, rules, kk)].name}`.toLowerCase().includes(q) || String(Math.abs(t.amount)).replace('.', ',').includes(q.replace('.', ',')));
  // Overførsler mellem egne konti tæller ikke som forbrug/indtægt
  const ext = list.filter((t) => !(t.partyKey && kk.includes(t.partyKey)));
  const ud = ext.filter((t) => t.amount < 0).reduce((s2, t) => s2 + Math.abs(t.amount), 0);
  const ind = ext.filter((t) => t.amount > 0).reduce((s2, t) => s2 + t.amount, 0);
  return `<section class="glass card">
    ${head(list.length)}
    ${ctrl}
    <div class="pv-sum three"><div><span class="muted small">Ud</span><b>−${kr(ud, false)}</b></div><div><span class="muted small">Ind</span><b class="pos">+${kr(ind, false)}</b></div><div><span class="muted small">I alt</span><b class="${ind - ud >= 0 ? 'pos' : ''}">${ind - ud >= 0 ? '+' : '−'}${kr(Math.abs(ind - ud), false)}</b></div></div>
    ${dataFromNote(accs)}
    ${list.length ? `<ul class="tx-list">${list.slice(0, 400).map((t) => txRow(t, { showAcc: !ui.acc && ui.accounts.length > 1, rules })).join('')}</ul>${list.length > 400 ? '<p class="muted small">Viser de 400 nyeste. Gør perioden kortere for at se flere.</p>' : ''}` : `<p class="muted">${q ? 'Ingen posteringer passer til søgningen.' : 'Ingen posteringer i perioden.'}</p>`}
  </section>`;
}

function findTx(id, acct) {
  for (const v of ui.tx.values()) { const t = v?.find((x) => x.id === id && (!acct || x.acct === acct)); if (t) return t; }
  return null;
}
function openCatPicker(t) {
  const key = partyKeyOf(t);
  const cur = categorize(t, txRules(), knownKeys());
  const m = openModal({
    title: 'Hvilken kategori?',
    body: `<p class="muted small">${esc(t.text || t.party)} · ${kr(Math.abs(t.amount), false)}</p>
      <div class="cat-grid">${CATEGORIES.filter((c) => c.id !== 'internal' && (t.amount < 0 ? !['income', 'moneyin'].includes(c.id) : ['income', 'moneyin', 'other'].includes(c.id))).map((c) => `<button type="button" class="cat-opt ${c.id === cur ? 'on' : ''}" data-c="${c.id}">${c.icon} ${esc(c.name)}</button>`).join('')}</div>
      <p class="muted small">Gælder alle posteringer fra <b>${esc(key || t.text)}</b> — også fremover. Alle i budgettet ser den samme kategori.</p>`,
    onOpen: (f) => f.querySelectorAll('[data-c]').forEach((b) => (b.onclick = async () => {
      if (!canEdit()) { toast('Kun admin og redaktører kan ændre kategorier', 'error'); return; }
      try { await saveTxRule(key, b.dataset.c); m.close(); toast(`${CAT[b.dataset.c].name} — husket for ${key}`); } catch (e) { errorToast(e); }
    })),
  });
}
const openItemById = (id) => { const it = state.items.find((x) => x.id === id); if (it) openItemModal(it); else toast('Posten findes ikke længere', 'error'); };
const scrollToFold = (id) => setTimeout(() => { const el = document.querySelector(`[data-fold="${id}"]`); if (el) { el.open = true; foldState[id] = true; el.scrollIntoView({ behavior: 'smooth', block: 'start' }); } }, 80);

function bind(root) {
  const w = root.firstElementChild;
  // Husk hvad der er foldet sammen (toggle bobler ikke → capture)
  w.addEventListener('toggle', (e) => { const id = e.target.dataset?.fold; if (id) { foldState[id] = e.target.open; lsSet('bb:bankFold', foldState); } }, true);
  w.addEventListener('submit', (e) => {
    if (e.target.id !== 'bk-period') return;
    e.preventDefault();
    let f = e.target.from.value, t = e.target.to.value;
    if (!f || !t) return;
    if (f > t) [f, t] = [t, f];
    ui.quick = ''; ui.from = f; ui.to = t; saveUi(); emit();
  });
  w.addEventListener('click', async (e) => {
    if (e.target.closest('.help-btn')) return;
    const b = e.target.closest('[data-b]');
    const act = b?.dataset.b;
    if (act === 'retry') { ui.status = null; loadStatus(true); }
    if (act === 'setup') openSetupWizard();
    if (act === 'connect') openBankPicker();
    if (act === 'renew') startConnect(b.dataset.bank, b.dataset.country, b);
    if (act === 'key') openKeyMenu();
    if (act === 'sync-all') for (const a of ui.accounts.filter((x) => x.owners?.includes(state.user.uid))) doSync(a);
    if (act === 'end') {
      if (!(await confirmDialog(`Afbryd forbindelsen til <b>${esc(b.dataset.bank)}</b>? Appen henter så ikke mere fra banken. Det, der allerede er hentet, bliver liggende, indtil du fjerner kontiene.`, { okLabel: 'Afbryd' }))) return;
      try { await bankApi(`/session?id=${encodeURIComponent(b.dataset.id)}`, { method: 'DELETE' }); toast('Forbindelsen er afbrudt'); loadStatus(true); } catch (err) { errorToast(err); }
    }
    const al = e.target.closest('[data-alert]');
    if (al) {
      const [kind, arg] = al.dataset.alert.split(':');
      if (kind === 'item') openItemById(arg);
      if (kind === 'conn') scrollToFold('conn');
      if (kind === 'plan') scrollToFold('plan');
      if (kind === 'sub') { ui.sub = arg; saveUi(); window.scrollTo({ top: 0 }); emit(); }
      if (kind === 'view') location.hash = arg;
    }
    const oi = e.target.closest('[data-open-item]');
    if (oi) openItemById(oi.dataset.openItem);
    const sb = e.target.closest('[data-bsub]');
    if (sb) { ui.sub = sb.dataset.bsub; saveUi(); window.scrollTo({ top: 0 }); emit(); }
    const pick = e.target.closest('[data-pick]');
    if (pick) { ui.acc = pick.dataset.pick; saveUi(); emit(); toast(`Viser kun ${accName(ui.acc)}`); }
    const sy = e.target.closest('[data-sync]');
    if (sy) doSync(ui.accounts.find((a) => a.id === sy.dataset.sync));
    const un = e.target.closest('[data-unlink]');
    if (un) {
      const a = ui.accounts.find((x) => x.id === un.dataset.unlink);
      const joint = a.owners.length > 1;
      if (!(await confirmDialog(joint
        ? `Fjern dig fra fælleskontoen <b>${esc(acctLabel(a))}</b>? Den bliver i budgettet for de andre, der har koblet den på.`
        : `Fjern <b>${esc(acctLabel(a))}</b> fra budgettet? Alle hentede posteringer for kontoen slettes fra appen (ikke fra banken).`, { okLabel: 'Fjern' }))) return;
      try { await unlinkAccount(a); toast(joint ? 'Du er fjernet fra kontoen' : 'Kontoen er fjernet'); } catch (err) { errorToast(err); }
    }
    const ym = e.target.closest('[data-ym]');
    if (ym) { ui.ym = ym.dataset.ym; emit(); }
    const oc = e.target.closest('[data-open-cat]');
    if (oc) { ui.openCat = ui.openCat === oc.dataset.openCat ? null : oc.dataset.openCat; emit(); }
    const qk = e.target.closest('[data-quick]');
    if (qk) { ui.quick = qk.dataset.quick; ensurePeriod(); saveUi(); emit(); }
    const tc = e.target.closest('[data-tx-cat]');
    if (tc) { const t = findTx(tc.dataset.txCat, tc.dataset.txAcct); if (t) openCatPicker(t); }
    const sg = e.target.closest('[data-sug]');
    if (sg) {
      const s = ui.sug[Number(sg.dataset.sug)];
      openItemModal({ type: 'expense', name: s.name, amount: s.amount, freq: 1, payDay: s.day, account: s.account, category: 'Andet', active: true, startMonth: currentYm(), visibleTo: defaultVisibleTo(), note: 'Fundet i banken' });
    }
    const as = e.target.closest('[data-add-sub]');
    if (as) {
      const r = ui.subs[Number(as.dataset.addSub)];
      const acct = (ui.acc && ui.accounts.find((a) => a.id === ui.acc)) || ui.accounts.find((a) => a.budgetAccount) || {};
      openItemModal({ type: 'expense', name: r.name, amount: r.amount, freq: r.freq, payDay: Number(r.last.slice(8, 10)), startMonth: indexToYm(dateToIndex(new Date(r.last)) + r.freq), account: acct.budgetAccount || '', category: 'Abonnementer', active: true, visibleTo: defaultVisibleTo(), note: 'Fundet i banken' });
    }
  });
  w.addEventListener('change', async (e) => {
    const m = e.target.closest('[data-map]');
    if (m) {
      const a = ui.accounts.find((x) => x.id === m.dataset.map);
      try { await setBudgetAccount(a, m.value); toast(m.value ? `${acctLabel(a)} hører nu til ${m.value}` : 'Koblingen er fjernet'); } catch (err) { errorToast(err); }
    }
    const v = e.target.closest('[data-vis]');
    if (v) {
      const a = ui.accounts.find((x) => x.id === v.dataset.vis);
      try { await setVisibility(a, v.value === 'adults'); toast(v.value === 'adults' ? 'Alle voksne i budgettet kan nu se kontoen' : 'Kontoen er nu privat'); } catch (err) { errorToast(err); }
    }
    const rn = e.target.closest('[data-rename]');
    if (rn) {
      const a = ui.accounts.find((x) => x.id === rn.dataset.rename);
      try { await renameAccount(a, rn.value); toast(rn.value.trim() ? `Kontoen hedder nu ${rn.value.trim()}` : 'Navnet er fjernet'); } catch (err) { errorToast(err); }
    }
    if (e.target.id === 'bk-acc') { ui.acc = e.target.value; ui.openCat = null; saveUi(); emit(); }
  });
  const q = w.querySelector('#bk-q');
  if (q) {
    q.addEventListener('input', () => { ui.q = q.value; emit(); });
    q.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); q.blur(); } });
  }
}

// ---------- Guide: kom i gang med Enable Banking ----------
const STEPS = [
  {
    t: '🏦 Sådan kobler du banken på',
    b: `<p>Banker giver ikke apps direkte adgang. Derfor går det gennem <b>Enable Banking</b>, som er godkendt til at hente kontooplysninger for dig. Det er gratis, når det kun er dine egne konti.</p>
      <ul class="steps-list"><li>⏱️ Det tager ca. 10 minutter</li><li>📱 Du skal bruge MitID</li><li>🔒 Appen kan kun <b>læse</b> saldo og posteringer — aldrig flytte penge</li><li>🗓️ Du skal logge ind med MitID igen ca. hver 6. måned</li></ul>
      <p class="muted small">Navnene på knapperne hos Enable Banking kan være lidt anderledes end her.</p>`,
  },
  {
    t: '1. Opret en gratis konto',
    b: `<p>Åbn Enable Banking og opret en konto med din e-mail. Du får en mail med et link til at logge ind.</p>
      <p><a class="btn ghost" href="https://enablebanking.com/sign-in/" target="_blank" rel="noopener">Åbn enablebanking.com ↗</a></p>
      <p class="muted small">Kom tilbage hertil, når du er logget ind.</p>`,
  },
  {
    t: '2. Opret en "app"',
    b: () => `<p>Gå til <b>API applications</b> og tryk på knappen for at registrere en ny app. Udfyld:</p>
      <ul class="steps-list">
        <li><b>Environment:</b> Production</li>
        <li><b>Name:</b> BudgetBasen</li>
        <li><b>Allowed redirect URLs:</b> kopiér præcis denne adresse:
          <div class="copy-box"><code>${esc(appRedirect())}</code><button type="button" class="btn small ghost" data-copy="${esc(appRedirect())}">Kopiér</button></div></li>
        <li>Spørger den efter en <b>privatlivspolitik</b> eller <b>vilkår</b>, kan du bruge den samme adresse.</li>
        <li>Vælg at <b>generere nøglen i browseren</b>. Så downloades en fil, der ender på <code>.pem</code> — gem den.</li>
      </ul>
      <p>Når appen er oprettet, står der et <b>App-ID</b> (en lang kode med bindestreger). Det skal du bruge om lidt.</p>`,
  },
  {
    t: '3. Kobl dine konti på hos Enable Banking',
    b: `<p>Den gratis udgave virker kun med de konti, du selv har godkendt inde hos Enable Banking:</p>
      <ul class="steps-list"><li>Find din nye app i listen og vælg <b>aktivér ved at koble konti på</b> ("Activate by linking accounts").</li>
      <li>Vælg din bank og log ind med <b>MitID</b>.</li>
      <li>Vælg <b>alle</b> de konti, du vil kunne se i BudgetBasen — også fælleskontoen.</li></ul>
      <p class="muted small">Har din partner sin egen bank, laver hun/han sin egen gratis konto og app på samme måde.</p>`,
  },
  {
    t: '4. Sæt nøglen ind her',
    b: `<p>Indsæt App-ID og vælg nøglefilen (.pem). Den sendes direkte til jeres server og gemmes krypteret. Du kan altid slette den igen.</p>
      <label>App-ID<input name="appId" placeholder="fx 1a2b3c4d-1234-…" autocomplete="off" spellcheck="false"></label>
      <label>Nøglefil (.pem)<input type="file" name="pemFile" accept=".pem,.key,.txt,application/x-pem-file"></label>
      <details class="more"><summary>Eller indsæt nøglen som tekst</summary><textarea name="pemText" rows="4" placeholder="-----BEGIN PRIVATE KEY-----"></textarea></details>`,
  },
];

export function openSetupWizard(startAt = 0) {
  let i = startAt;
  let el;
  const m = openModal({
    title: STEPS[i].t, wide: true,
    body: '<div id="wz-body"></div><div class="dots" id="wz-dots"></div>',
    submitLabel: 'Næste',
    buttons: [{ label: '← Tilbage', cls: 'ghost', onClick: () => { if (i > 0) { i--; draw(); } return false; } }],
    onOpen: (f) => { el = f; draw(); },
    onSubmit: async (fd) => {
      if (i < STEPS.length - 1) { i++; draw(); return false; }
      const appId = String(fd.get('appId') || '').trim();
      let pem = String(fd.get('pemText') || '').trim();
      const file = fd.get('pemFile');
      if (!pem && file && file.size) pem = (await file.text()).trim();
      if (!appId || !pem) { toast('Indsæt App-ID og vælg nøglefilen', 'error'); return false; }
      const r = await bankApi('/config', { method: 'POST', body: { appId, pem } });
      ui.status = null; loadStatus(true);
      const redirectOk = (r.redirectUrls || []).some((u) => u.replace(/\/+$/, '') === appRedirect().replace(/\/+$/, ''));
      toast(`Nøglen virker 🎉 (app: ${r.appName || 'uden navn'})`, 'ok', 5000);
      setTimeout(() => {
        if (!redirectOk) {
          openModal({ title: 'Én ting mangler', body: `<p>Nøglen virker, men adressen herunder står ikke under <b>Allowed redirect URLs</b> i din Enable Banking-app. Tilføj den, ellers kan banken ikke sende dig tilbage hertil efter MitID:</p>
            <div class="copy-box"><code>${esc(appRedirect())}</code><button type="button" class="btn small ghost" data-copy="${esc(appRedirect())}">Kopiér</button></div>` });
        } else if (r.active === false) {
          openModal({ title: 'Næsten færdig', body: '<p>Appen hos Enable Banking er ikke aktiveret endnu. Gå tilbage til trin 3 og kobl dine konti på inde hos Enable Banking. Bagefter kan du koble banken på her.</p>' });
        } else openBankPicker();
      }, 300);
      return true;
    },
  });
  function draw() {
    const s = STEPS[i];
    el.querySelector('.modal-head h2').textContent = s.t;
    el.querySelector('#wz-body').innerHTML = typeof s.b === 'function' ? s.b() : s.b;
    el.querySelector('#wz-dots').innerHTML = STEPS.map((_, k) => `<i class="${k === i ? 'on' : ''}"></i>`).join('');
    el.querySelector('[type=submit]').textContent = i === STEPS.length - 1 ? 'Gem nøglen' : i === 0 ? 'Kom i gang' : 'Næste';
    el.querySelector('.left-btns .btn').classList.toggle('hidden', i === 0);
  }
  return m;
}
document.addEventListener('click', (e) => {
  const c = e.target.closest('[data-copy]');
  if (c) { e.preventDefault(); copyText(c.dataset.copy); }
});

function openKeyMenu() {
  const s = ui.status || {};
  openModal({
    title: '🔑 Din Enable Banking-nøgle',
    body: `<p>App: <b>${esc(s.appName || 'ukendt')}</b> ${s.environment ? `<span class="chip">${esc(s.environment)}</span>` : ''}</p>
      <p class="muted small">Adresse banken sender dig tilbage til (skal stå i din Enable Banking-app):</p>
      <div class="copy-box"><code>${esc(appRedirect())}</code><button type="button" class="btn small ghost" data-copy="${esc(appRedirect())}">Kopiér</button></div>`,
    buttons: [
      { label: 'Skift nøgle', cls: 'ghost', onClick: () => { setTimeout(() => openSetupWizard(STEPS.length - 1), 250); } },
      {
        label: 'Slet nøgle og forbindelser', cls: 'danger-ghost',
        onClick: async () => {
          if (!(await confirmDialog('Slet din nøgle og afbryd alle dine bankforbindelser? Hentede posteringer bliver liggende, indtil du fjerner kontiene.', { okLabel: 'Slet' }))) return false;
          await bankApi('/config', { method: 'DELETE' });
          toast('Nøglen er slettet'); ui.status = null; loadStatus(true);
        },
      },
    ],
  });
}

// ---------- Vælg bank ----------
const COUNTRIES = [['DK', 'Danmark'], ['FO', 'Færøerne'], ['SE', 'Sverige'], ['NO', 'Norge'], ['FI', 'Finland'], ['DE', 'Tyskland']];
export function openBankPicker() {
  let banks = [], country = 'DK', q = '';
  let el;
  openModal({
    title: 'Vælg din bank',
    body: `<div class="pair"><label>Land<select id="bp-c">${COUNTRIES.map(([c, n]) => `<option value="${c}">${n}</option>`).join('')}</select></label>
      <label>Søg<input id="bp-q" type="search" placeholder="fx Sparekassen" autocomplete="off"></label></div>
      <div id="bp-list" class="bank-pick"><p class="muted">Henter banker …</p></div>
      <p class="muted small">Når du vælger en bank, sendes du til bankens MitID-login. Bagefter kommer du automatisk tilbage hertil.</p>`,
    onOpen: (f) => {
      el = f;
      f.querySelector('#bp-c').onchange = (e) => { country = e.target.value; load(); };
      f.querySelector('#bp-q').oninput = (e) => { q = e.target.value.toLowerCase(); draw(); };
      load();
    },
  });
  async function load() {
    el.querySelector('#bp-list').innerHTML = '<p class="muted">Henter banker …</p>';
    try { banks = (await bankApi(`/aspsps?country=${country}`)).banks || []; draw(); } catch (e) { el.querySelector('#bp-list').innerHTML = `<p class="hint warn">${esc(e.message)}</p>`; }
  }
  function draw() {
    const list = banks.filter((b) => !q || b.name.toLowerCase().includes(q));
    el.querySelector('#bp-list').innerHTML = list.length
      ? list.map((b) => `<button type="button" class="bank-opt" data-bank="${esc(b.name)}">${b.logo ? `<img src="${esc(b.logo)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : '<span>🏦</span>'}<span>${esc(b.name)}${b.beta ? ' <small class="chip">beta</small>' : ''}</span></button>`).join('')
      : `<p class="muted">${banks.length ? 'Ingen banker passer til søgningen.' : 'Enable Banking har ingen banker for dette land.'}</p>`;
    el.querySelectorAll('[data-bank]').forEach((x) => (x.onclick = () => startConnect(x.dataset.bank, country, x)));
  }
}

async function startConnect(bank, country, btn) {
  if (btn) btn.disabled = true;
  try {
    const r = await bankApi('/connect', { method: 'POST', body: { bank, country, redirectUrl: appRedirect() } });
    rememberBudgetForBank(state.budgetId);
    toast(`Sender dig til ${bank} …`, 'ok', 3000);
    location.href = r.url;
  } catch (e) { errorToast(e); if (btn) btn.disabled = false; }
}

// ---------- Tilbage fra banken ----------
export async function handleBankCallback(selectBudget, setView) {
  const cb = takeCallback();
  if (!cb) return;
  const bid = bankBudget();
  if (bid && bid !== state.budgetId && state.budgets.some((b) => b.id === bid)) selectBudget(bid);
  setView('bank');
  if (cb.error) { toast(`Banken afbrød: ${cb.desc || cb.error}`, 'error', 7000); return; }
  let r;
  try { r = await bankApi('/callback', { method: 'POST', body: { code: cb.code, state: cb.state } }); } catch (e) { errorToast(e); return; }
  ui.status = null; loadStatus(true);
  await new Promise((res) => setTimeout(res, 400));
  openLinkModal(r);
}

function guessAccount(name) {
  const n = String(name || '').toLowerCase().replace(/[^a-zæøå]/g, '');
  return lists().accounts.find((a) => { const x = a.toLowerCase().replace(/[^a-zæøå]/g, ''); return x && (n.includes(x) || x.includes(n)); }) || '';
}

function openLinkModal(r) {
  const me = state.user.uid;
  const mine = new Set((ui.accounts || []).filter((a) => a.owners?.includes(me)).map((a) => a.id));
  const renew = r.accounts.filter((a) => mine.has(a.key));
  const fresh = r.accounts.filter((a) => !mine.has(a.key));
  const L = lists();
  if (renew.length) linkAccounts(renew.map((a) => ({ ...a })), { bank: r.bank, validUntil: r.validUntil }).catch(errorToast);
  if (!fresh.length) {
    toast(`Adgangen til ${r.bank} er fornyet 🎉`, 'ok', 5000);
    for (const a of (ui.accounts || []).filter((x) => renew.some((y) => y.key === x.id))) doSync(a, true);
    return;
  }
  openModal({
    title: `Konti fra ${r.bank}`, wide: true,
    body: `<p>Vælg de konti, der skal med i budgettet <b>${esc(state.budget.name)}</b>.</p>
      ${renew.length ? `<p class="muted small">✓ ${renew.length} konto/konti var allerede med og er fornyet.</p>` : ''}
      ${fresh.map((a, i) => `<fieldset class="link-acct">
        <label class="check big-check"><input type="checkbox" name="use_${i}" checked> <span><b>${esc(a.name)}</b> <span class="muted small">${esc(a.masked)}</span></span></label>
        <label>Dit navn til kontoen (valgfrit)<input name="lbl_${i}" maxlength="40" placeholder="fx Budgetkonto eller Madkonto" autocomplete="off"></label>
        <div class="pair">
          <label>Hører til i budgettet<select name="map_${i}"><option value="">— ingen —</option>${L.accounts.map((x) => `<option ${x === guessAccount(a.name) ? 'selected' : ''}>${esc(x)}</option>`).join('')}</select></label>
          <label>Hvem må se den?<select name="vis_${i}"><option value="owners">Kun mig</option><option value="adults">Alle voksne i budgettet</option></select></label>
        </div></fieldset>`).join('')}
      <p class="muted small">Har din partner allerede koblet den samme konto på, genkender appen den og markerer den som <b>fælles</b>. Børn og andre med "Kun læse" kan aldrig se bankkonti.</p>`,
    submitLabel: 'Tilføj konti',
    onSubmit: async (fd) => {
      const choices = fresh.map((a, i) => (fd.get(`use_${i}`) ? { ...a, label: String(fd.get(`lbl_${i}`) || '').trim(), budgetAccount: fd.get(`map_${i}`) || '', shareAdults: fd.get(`vis_${i}`) === 'adults' } : null)).filter(Boolean);
      if (!choices.length) return true;
      const res = await linkAccounts(choices, { bank: r.bank, validUntil: r.validUntil });
      const joint = res.filter((x) => x.status === 'joint').length;
      toast(joint ? `Tilføjet — ${joint} konto/konti er genkendt som fælles 👨‍👩‍👧` : 'Kontiene er tilføjet. Henter posteringer …', 'ok', 5000);
      setTimeout(() => { for (const a of (ui.accounts || []).filter((x) => choices.some((c) => c.key === x.id) && needsSync(x))) doSync(a, true); }, 1200);
    },
  });
}
