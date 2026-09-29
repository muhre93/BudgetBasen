// Admin: budgetter, medlemmer & invitationer, fleksible lister, frekvenser, delte links, versioner, log og eksport.
import { state, isAdmin, isOwner, canEdit, lists, LIST_DEFS, ROLES, role } from '../state.js';
import {
  esc, kr, fmtDate, openModal, confirmDialog, promptDialog, toast, errorToast, copyText, download, toDate,
} from '../ui.js';
import { freqLabel, monthly } from '../calc.js';
import {
  createBudget, updateBudget, deleteBudgetCompletely, leaveBudget, inviteMember, revokeInvite, setMemberRole, removeMember,
  addListValue, renameListValue, removeListValue, addFrequency, listSnapshots, deleteSnapshot, loadLog, budgetRef, sub,
} from '../data.js';
import { updateDoc, serverTimestamp, getDocs } from '../firebase.js';
import { fullBackupToExcel, runExport, safeFile } from '../export.js';
import { noticeDeadline } from './documents.js';
import { deleteShare, shareUrl } from './share.js';
import { openCompareDialog } from './compare.js';

const ui = { tab: 'budgets', log: null, logFilter: '', snaps: null };
export function setSelectBudget(fn) { ui.selectBudget = fn; }

const TABS = [
  { id: 'budgets', label: 'Budgetter' },
  { id: 'members', label: 'Medlemmer', admin: true },
  { id: 'lists', label: 'Lister', admin: true },
  { id: 'shares', label: 'Delte links', admin: true },
  { id: 'versions', label: 'Versioner' },
  { id: 'log', label: 'Log' },
  { id: 'data', label: 'Eksport' },
];

export function render(root) {
  const tabs = TABS.filter((t) => !t.admin || isAdmin());
  if (!tabs.some((t) => t.id === ui.tab)) ui.tab = 'budgets';
  root.innerHTML = `
    <nav class="subtabs glass">${tabs.map((t) => `<button data-tab="${t.id}" class="${t.id === ui.tab ? 'active' : ''}">${t.label}</button>`).join('')}</nav>
    ${!isAdmin() ? `<p class="hint">Du er <b>${esc(ROLES[role()] || '')}</b> i dette budget. Medlemmer, lister og delte links styres af en admin.</p>` : ''}
    <div id="admin-body"></div>`;
  root.querySelectorAll('[data-tab]').forEach((b) => (b.onclick = () => { ui.tab = b.dataset.tab; render(root); }));
  const body = root.querySelector('#admin-body');
  ({ budgets, members, lists: listsTab, shares, versions, log, data })[ui.tab](body, root);
}

// ---------- Budgetter ----------
function budgets(el, root) {
  el.innerHTML = `
    <section class="glass card">
      <div class="section-head"><h2>Mine budgetter</h2><button class="btn primary small" id="ad-new">＋ Nyt budget</button></div>
      <ul class="rows">${state.budgets.map((b) => {
        const r = b.ownerUid === state.user.uid ? 'Ejer' : ROLES[b.members?.[state.user.uid]] || '';
        return `<li class="${b.id === state.budgetId ? 'current' : ''}"><div><b>${esc(b.name)}</b><div class="muted small">${r} · ${Object.keys(b.members || {}).length} medlem(mer)</div></div>
          ${b.id === state.budgetId ? '<span class="chip ok">Aktivt</span>' : `<button class="btn small ghost" data-open="${b.id}">Åbn</button>`}</li>`;
      }).join('')}</ul>
    </section>
    <section class="glass card">
      <h2>Dette budget: ${esc(state.budget.name)}</h2>
      <div class="btn-row">
        ${isAdmin() ? '<button class="btn ghost" id="ad-rename">Omdøb</button>' : ''}
        <button class="btn ghost" id="ad-dup">Kopiér til nyt budget</button>
        ${isOwner() ? '<button class="btn danger-ghost" id="ad-del">Slet budget permanent</button>' : '<button class="btn danger-ghost" id="ad-leave">Forlad budget</button>'}
      </div>
    </section>`;
  el.querySelector('#ad-new').onclick = async () => {
    const name = await promptDialog('Nyt budget', { label: 'Navn', placeholder: 'f.eks. Sommerhus, Budget 2027' });
    if (!name) return;
    try { const id = await createBudget(name); ui.selectBudget?.(id); toast('Budget oprettet'); } catch (e) { errorToast(e); }
  };
  el.querySelector('#ad-dup').onclick = async () => {
    const name = await promptDialog('Kopiér budget', { label: 'Navn på kopien', value: `${state.budget.name} (kopi)` });
    if (!name) return;
    try { const id = await createBudget(name, { copyFromId: state.budgetId }); ui.selectBudget?.(id); toast('Kopi oprettet — medlemmer kopieres ikke med'); } catch (e) { errorToast(e); }
  };
  el.querySelectorAll('[data-open]').forEach((b) => (b.onclick = () => ui.selectBudget?.(b.dataset.open)));
  el.querySelector('#ad-rename')?.addEventListener('click', async () => {
    const name = await promptDialog('Omdøb budget', { label: 'Nyt navn', value: state.budget.name });
    if (name) updateBudget({ name }, `Omdøbt til ${name}`).catch(errorToast);
  });
  el.querySelector('#ad-del')?.addEventListener('click', async () => {
    if (!(await confirmDialog(`Alt i <b>${esc(state.budget.name)}</b> slettes permanent — poster, kvitteringer, dokumenter, filer og log. Det kan ikke fortrydes.`, { okLabel: 'Slet alt', requireText: 'SLET' }))) return;
    try { const b = state.budget; await deleteBudgetCompletely(b); } catch (e) { errorToast(e); }
  });
  el.querySelector('#ad-leave')?.addEventListener('click', async () => {
    if (!(await confirmDialog(`Forlad <b>${esc(state.budget.name)}</b>? Du skal inviteres igen for at få adgang.`))) return;
    leaveBudget().catch(errorToast);
  });
}

// ---------- Medlemmer ----------
function members(el) {
  const b = state.budget;
  const memberEmails = new Set(Object.values(b.memberInfo || {}).map((m) => m.email));
  const pending = (b.invites || []).filter((i) => !memberEmails.has(i.email));
  const roleSel = (uid, cur) => `<select data-role="${uid}">${Object.entries(ROLES).map(([k, v]) => `<option value="${k}" ${k === cur ? 'selected' : ''}>${v}</option>`).join('')}</select>`;
  const appUrl = `${location.origin}${location.pathname}`;
  el.innerHTML = `
    <section class="glass card">
      <h2>Medlemmer</h2>
      <ul class="rows">${Object.entries(b.members || {}).map(([uid, r]) => {
        const info = b.memberInfo?.[uid] || {};
        const owner = uid === b.ownerUid;
        return `<li><div class="who">${info.photo ? `<img src="${esc(info.photo)}" alt="" referrerpolicy="no-referrer">` : '<span class="avatar-ph"></span>'}
          <div><b>${esc(info.name || uid)}</b>${uid === state.user.uid ? ' <small class="muted">(dig)</small>' : ''}<div class="muted small">${esc(info.email || '')}</div></div></div>
          <div class="row-actions">${owner ? '<span class="chip ok">Ejer</span>' : `${roleSel(uid, r)}<button class="icon-btn" data-remove="${uid}" title="Fjern">✕</button>`}</div></li>`;
      }).join('')}</ul>
      <details class="explain"><summary>Hvad må de forskellige roller?</summary>
        <p><b>Admin</b>: alt — inkl. invitere, ændre roller, redigere lister og oprette delte links.<br>
        <b>Redaktør</b>: tilføje/ændre/slette poster, kvitteringer og dokumenter, opdatere saldo.<br>
        <b>Kun læse</b>: se alt, men ikke ændre noget. Kan udskrive.</p></details>
    </section>
    <section class="glass card">
      <h2>Invitér</h2>
      <form id="inv-form" class="inline-form">
        <input type="email" name="email" placeholder="Google-mail, f.eks. maria@gmail.com" required>
        <select name="role">${Object.entries(ROLES).map(([k, v]) => `<option value="${k}" ${k === 'edit' ? 'selected' : ''}>${v}</option>`).join('')}</select>
        <button class="btn primary">Invitér</button>
      </form>
      <p class="muted small">Personen skal blot logge ind på <a href="${esc(appUrl)}">${esc(appUrl)}</a> med den Google-konto — så dukker invitationen op.</p>
      ${pending.length ? `<h3>Afventer</h3><ul class="rows">${pending.map((i) => `<li><div><b>${esc(i.email)}</b><div class="muted small">${ROLES[i.role]} · inviteret ${fmtDate(new Date(i.at))}</div></div>
        <div class="row-actions"><a class="btn small ghost" href="mailto:${esc(i.email)}?subject=${encodeURIComponent('Invitation til BudgetBasen')}&body=${encodeURIComponent(`Hej!\n\nJeg har inviteret dig til budgettet "${b.name}" i BudgetBasen.\nLog ind med din Google-konto her: ${appUrl}\n`)}">Send mail</a>
        <button class="icon-btn" data-revoke="${esc(i.email)}" title="Tilbagekald">✕</button></div></li>`).join('')}</ul>` : ''}
    </section>`;
  el.querySelector('#inv-form').onsubmit = async (e) => {
    e.preventDefault();
    const f = e.target;
    try { await inviteMember(f.email.value, f.role.value); toast('Invitation oprettet'); f.reset(); } catch (err) { errorToast(err); }
  };
  el.querySelectorAll('[data-role]').forEach((s) => (s.onchange = () => setMemberRole(s.dataset.role, s.value).then(() => toast('Rolle opdateret')).catch(errorToast)));
  el.querySelectorAll('[data-remove]').forEach((b) => (b.onclick = async () => {
    const info = state.budget.memberInfo?.[b.dataset.remove];
    if (await confirmDialog(`Fjern <b>${esc(info?.name || '')}</b> fra budgettet?`)) removeMember(b.dataset.remove).catch(errorToast);
  }));
  el.querySelectorAll('[data-revoke]').forEach((b) => (b.onclick = () => revokeInvite(b.dataset.revoke).catch(errorToast)));
}

// ---------- Lister ----------
function listsTab(el) {
  const L = lists();
  const usage = (key, v) => {
    const f = { categories: 'category', people: 'who', suppliers: 'supplier', methods: 'method', accounts: 'account' }[key];
    return f ? state.items.filter((i) => i[f] === v).length : 0;
  };
  el.innerHTML = `
    <p class="hint">Alle dropdown-menuer i appen bygger på disse lister. Omdøber du en værdi, opdateres alle poster, kvitteringer og dokumenter der bruger den.</p>
    ${LIST_DEFS.map((d) => `
      <section class="glass card list-card">
        <h3>${esc(d.label)}</h3>
        <div class="chips">${L[d.key].map((v) => {
          const n = usage(d.key, v);
          return `<span class="chip edit"><button class="link" data-rename="${d.key}" data-v="${esc(v)}">${esc(v)}</button>${n ? `<small>${n}</small>` : ''}<button class="x" data-del="${d.key}" data-v="${esc(v)}" aria-label="Slet">✕</button></span>`;
        }).join('') || '<span class="muted small">Tom</span>'}</div>
        <form class="inline-form" data-add="${d.key}"><input name="v" placeholder="Tilføj ${esc(d.single)}…" required><button class="btn small primary">Tilføj</button></form>
      </section>`).join('')}
    <section class="glass card list-card">
      <h3>Betalingsfrekvenser</h3>
      <ul class="rows compact">${L.frequencies.map((f) => `<li><div><b>${esc(f.label)}</b> <span class="muted small">hver ${f.months}. måned · beløb ÷ ${f.months} = pr. md.</span></div>
        <div class="row-actions"><button class="btn small ghost" data-frename="${f.months}">Omdøb</button><button class="icon-btn" data-fdel="${f.months}">✕</button></div></li>`).join('')}</ul>
      <form class="inline-form" id="freq-form"><input name="months" type="number" min="1" max="120" placeholder="Måneder" required class="w-sm"><input name="label" placeholder="Navn, f.eks. Hver 18. måned"><button class="btn small primary">Tilføj</button></form>
    </section>`;

  el.querySelectorAll('[data-add]').forEach((f) => (f.onsubmit = async (e) => {
    e.preventDefault();
    try { await addListValue(f.dataset.add, f.v.value); f.reset(); } catch (err) { errorToast(err); }
  }));
  el.querySelectorAll('[data-rename]').forEach((b) => (b.onclick = async () => {
    const nv = await promptDialog('Omdøb', { label: 'Nyt navn', value: b.dataset.v });
    if (!nv || nv === b.dataset.v) return;
    try { const n = await renameListValue(b.dataset.rename, b.dataset.v, nv); toast(n ? `Omdøbt — ${n} poster opdateret` : 'Omdøbt'); } catch (err) { errorToast(err); }
  }));
  el.querySelectorAll('[data-del]').forEach((b) => (b.onclick = async () => {
    const n = usage(b.dataset.del, b.dataset.v);
    if (n && !(await confirmDialog(`<b>${esc(b.dataset.v)}</b> bruges af ${n} poster. De beholder værdien, men den forsvinder fra menuen. Fortsæt?`))) return;
    removeListValue(b.dataset.del, b.dataset.v).catch(errorToast);
  }));
  el.querySelector('#freq-form').onsubmit = async (e) => {
    e.preventDefault();
    const f = e.target;
    try { await addFrequency(f.months.value, f.label.value.trim() || freqLabel(f.months.value, [])); f.reset(); } catch (err) { errorToast(err); }
  };
  el.querySelectorAll('[data-frename]').forEach((b) => (b.onclick = async () => {
    const m = Number(b.dataset.frename);
    const cur = L.frequencies.find((f) => f.months === m);
    const label = await promptDialog('Omdøb frekvens', { label: 'Navn', value: cur.label });
    if (label) updateDoc(budgetRef(), { 'lists.frequencies': L.frequencies.map((f) => (f.months === m ? { ...f, label } : f)), updatedAt: serverTimestamp() }).catch(errorToast);
  }));
  el.querySelectorAll('[data-fdel]').forEach((b) => (b.onclick = async () => {
    const m = Number(b.dataset.fdel);
    const n = state.items.filter((i) => Number(i.freq) === m).length;
    if (n && !(await confirmDialog(`${n} poster bruger denne frekvens. De fortsætter med at blive beregnet korrekt, men valget forsvinder fra menuen. Fortsæt?`))) return;
    updateDoc(budgetRef(), { 'lists.frequencies': L.frequencies.filter((f) => f.months !== m), updatedAt: serverTimestamp() }).catch(errorToast);
  }));
}

// ---------- Delte links ----------
function shares(el) {
  const list = [...(state.budget.shares || [])].sort((a, b) => b.createdAt - a.createdAt);
  el.innerHTML = `<section class="glass card">
    <h2>Read-only links</h2>
    <p class="muted small">Opret nye links fra Budget-fanen → "Del / udskriv". Et link viser et øjebliksbillede af de valgte poster og opdateres ikke automatisk.</p>
    ${list.length ? `<ul class="rows">${list.map((s) => {
      const expired = s.expiresAt && s.expiresAt < Date.now();
      return `<li><div><b>${esc(s.title)}</b><div class="muted small">${s.count} poster · oprettet ${fmtDate(new Date(s.createdAt))} · ${s.expiresAt ? `${expired ? 'udløb' : 'udløber'} ${fmtDate(new Date(s.expiresAt))}` : 'udløber aldrig'}</div></div>
        <div class="row-actions">${expired ? '<span class="chip neg">Udløbet</span>' : `<button class="btn small ghost" data-copy="${s.token}">Kopiér</button><a class="btn small ghost" href="${shareUrl(s.token)}" target="_blank" rel="noopener">Åbn</a>`}
        <button class="icon-btn" data-del="${s.token}" title="Slet link">✕</button></div></li>`;
    }).join('')}</ul>` : '<p class="muted">Ingen delte links.</p>'}
  </section>`;
  el.querySelectorAll('[data-copy]').forEach((b) => (b.onclick = () => copyText(shareUrl(b.dataset.copy))));
  el.querySelectorAll('[data-del]').forEach((b) => (b.onclick = async () => {
    if (await confirmDialog('Slet linket? Den der har det, kan ikke længere åbne det.')) deleteShare(b.dataset.del).then(() => toast('Link slettet')).catch(errorToast);
  }));
}

// ---------- Versioner ----------
function versions(el, root) {
  if (!ui.snaps || ui.snapsFor !== state.budgetId) {
    ui.snapsFor = state.budgetId;
    el.innerHTML = '<div class="skeleton"></div>';
    listSnapshots().then((s) => { ui.snaps = s; render(root); }).catch((e) => { el.innerHTML = ''; errorToast(e); });
    return;
  }
  el.innerHTML = `<section class="glass card">
    <div class="section-head"><h2>Gemte versioner</h2><button class="btn small ghost" id="v-refresh">Opdatér</button></div>
    <p class="muted small">Appen gemmer automatisk én version pr. måned. Du kan også gemme manuelt fra Budget-fanen.</p>
    ${ui.snaps.length ? `<ul class="rows">${ui.snaps.map((s) => `<li><div><b>${esc(s.name)}</b><div class="muted small">${(s.items || []).length} poster · ${fmtDate(s.createdAt, true)}${s.createdByName ? ` · ${esc(s.createdByName)}` : ''}</div></div>
      <div class="row-actions"><button class="btn small ghost" data-cmp="${s.id}">Sammenlign</button>${isAdmin() ? `<button class="icon-btn" data-del="${s.id}">✕</button>` : ''}</div></li>`).join('')}</ul>` : '<p class="muted">Ingen versioner endnu.</p>'}
  </section>`;
  el.querySelector('#v-refresh').onclick = () => { ui.snaps = null; render(root); };
  el.querySelectorAll('[data-cmp]').forEach((b) => (b.onclick = () => openCompareDialog(b.dataset.cmp)));
  el.querySelectorAll('[data-del]').forEach((b) => (b.onclick = async () => {
    if (await confirmDialog('Slet versionen?')) { await deleteSnapshot(b.dataset.del).catch(errorToast); ui.snaps = null; render(root); }
  }));
}

// ---------- Log ----------
const ACTION = { create: 'tilføjede', update: 'ændrede', delete: 'slettede' };
const ENTITY = { item: 'post', receipt: 'kvittering', document: 'dokument', member: 'medlem', list: 'liste', balance: 'saldo', settings: 'indstilling', budget: 'budget', share: 'delt link', snapshot: 'version' };
function log(el, root) {
  if (!ui.log || ui.log.budgetId !== state.budgetId) {
    el.innerHTML = '<div class="skeleton"></div>';
    loadLog(300).then((rows) => { ui.log = { budgetId: state.budgetId, rows }; render(root); }).catch((e) => { el.innerHTML = ''; errorToast(e); });
    return;
  }
  const q = ui.logFilter.toLowerCase();
  const rows = ui.log.rows.filter((r) => !q || [r.name, r.label, ENTITY[r.entity], ACTION[r.action]].some((x) => String(x || '').toLowerCase().includes(q)));
  el.innerHTML = `<section class="glass card">
    <div class="section-head"><h2>Log-historik</h2><button class="btn small ghost" id="log-refresh">Opdatér</button></div>
    <input id="log-q" type="search" placeholder="Filtrér på person, post, handling…" value="${esc(ui.logFilter)}">
    <ul class="log">${rows.map((r) => `<li class="log-${r.action}">
      <div class="log-time">${fmtDate(r.at, true)}</div>
      <div><b>${esc(r.name)}</b> ${ACTION[r.action] || r.action} ${ENTITY[r.entity] || r.entity} <b>${esc(r.label)}</b>
      ${r.changes ? `<div class="log-changes">${Object.entries(r.changes).map(([k, v]) => `${esc(k)}: <s>${esc(fmtVal(v.from))}</s> → ${esc(fmtVal(v.to))}`).join(' · ')}</div>` : ''}</div>
    </li>`).join('') || '<li class="muted">Ingen hændelser.</li>'}</ul>
    <p class="muted small">Viser de seneste ${ui.log.rows.length} hændelser. Loggen kan ikke redigeres af nogen.</p>
  </section>`;
  el.querySelector('#log-refresh').onclick = () => { ui.log = null; render(root); };
  const qi = el.querySelector('#log-q');
  qi.oninput = () => { ui.logFilter = qi.value; render(root); };
}
const fmtVal = (v) => (v === '' || v === null || v === undefined ? '–' : typeof v === 'number' ? kr(v) : typeof v === 'boolean' ? (v ? 'ja' : 'nej') : String(v));

// ---------- Eksport ----------
async function loadAll(colName) {
  if (state.col[colName]) return state.col[colName];
  const snap = await getDocs(sub(colName));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}
function data(el) {
  el.innerHTML = `<section class="glass card">
    <h2>Eksport & backup</h2>
    <p class="muted small">Hele budgettet i én Excel-fil med et ark pr. sektion: poster, kvitteringer, dokumenter, kontosaldi og lister. Rapporter til banken laves fra Budget-fanen → "Del / eksportér".</p>
    <div class="btn-row">
      <button class="btn primary" id="ex-xlsx">Fuld backup (Excel)</button>
      <button class="btn ghost" id="ex-json">Teknisk backup (JSON)</button>
    </div>
    <p class="muted small">PDF og Excel findes også direkte på fanerne Likviditet, Kvitteringer og Dokumenter.</p>
  </section>
  <section class="glass card">
    <h2>Installér som app</h2>
    <p class="muted small"><b>iPhone:</b> Åbn i Safari → Del-knappen → "Føj til hjemmeskærm".<br><b>Android:</b> Chrome-menuen → "Installér app".<br>Så åbner kameraet direkte fra appen når du scanner kvitteringer.</p>
  </section>`;
  const safe = safeFile(state.budget.name);
  el.querySelector('#ex-xlsx').onclick = (e) => runExport(e.currentTarget, async () => {
    const F = lists().frequencies;
    const [receipts, documents] = await Promise.all([loadAll('receipts'), loadAll('documents')]);
    await fullBackupToExcel({ budget: state.budget, items: state.items, receipts, documents, freqLabel: (m) => freqLabel(m, F), monthly, deadlineOf: noticeDeadline });
  });
  el.querySelector('#ex-json').onclick = (e) => runExport(e.currentTarget, async () => {
    const [receipts, documents] = await Promise.all([loadAll('receipts'), loadAll('documents')]);
    const strip = (o) => JSON.parse(JSON.stringify(o, (k, v) => (v && typeof v.toDate === 'function' ? v.toDate().toISOString() : k === 'thumb' ? undefined : v)));
    const out = { exported: new Date().toISOString(), budget: strip({ name: state.budget.name, lists: state.budget.lists, settings: state.budget.settings }),
      items: strip(state.items), receipts: strip(receipts), documents: strip(documents) };
    download(`${safe}_backup_${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(out, null, 2), 'application/json');
  });
}
