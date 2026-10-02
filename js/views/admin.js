// Admin: budgetter, medlemmer & invitationer, fleksible lister, frekvenser, delte links, versioner, log og eksport.
import { state, isAdmin, isOwner, canEdit, lists, LIST_DEFS, ROLES, ROLE_HELP, role, ALL, jointAccounts, savingsAccounts } from '../state.js';
import {
  esc, kr, fmtDate, openModal, confirmDialog, promptDialog, toast, errorToast, copyText, download, toDate,
} from '../ui.js';
import { freqLabel, monthly } from '../calc.js';
import {
  createBudget, createDemoBudget, updateBudget, deleteBudgetCompletely, leaveBudget, inviteMember, sendInvite, revokeInvite, setMemberRole, removeMember, loadAll,
  addListValue, renameListValue, removeListValue, addFrequency, listSnapshots, deleteSnapshot, loadLog, budgetRef, sub,
} from '../data.js';
import { updateDoc, serverTimestamp } from '../firebase.js';
import { fullBackupToExcel, runExport, safeFile } from '../export.js';
import { noticeDeadline } from './documents.js';
import { deleteShare, shareUrl } from './share.js';
import { openCompareDialog } from './compare.js';
import { showWelcome } from '../help.js';
import { THEMES, getPrefs, setPrefs } from '../prefs.js';
import { feature } from '../config.js';

const ui = { tab: 'budgets', log: null, logFilter: '', snaps: null };
export function setSelectBudget(fn) { ui.selectBudget = fn; }
export function openTab(id) { ui.tab = id; }

const TABS = [
  { id: 'budgets', label: 'Budgetter' },
  { id: 'look', label: 'Udseende' },
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
  ({ budgets, look, members, lists: listsTab, shares, versions, log, data })[ui.tab](body, root);
}

// ---------- Budgetter ----------
function budgets(el, root) {
  el.innerHTML = `
    <section class="glass card">
      <div class="section-head"><h2>Mine budgetter</h2><span class="btn-row"><button class="btn primary small" id="ad-new">＋ Nyt budget</button><button class="btn ghost small" id="ad-private">🔒 Nyt privat budget</button></span></div>
      <p class="muted small">Et privat budget (fx din egen opsparing) kan kun du se — indtil du selv inviterer nogen.</p>
      <div class="demo-offer">
        <span>📚 <b>Prøvebudget</b> — se hvordan appen virker med en opdigtet familie.</span>
        <span class="btn-row"><button class="btn small ghost" id="ad-demo">${state.budgets.some((b) => b.settings?.demo && b.ownerUid === state.user.uid) ? 'Åbn prøvebudget' : 'Lav prøvebudget'}</button><button class="btn small ghost" id="ad-guide">Vis guiden igen</button></span>
      </div>
      <ul class="rows">${state.budgets.map((b) => {
        const r = b.ownerUid === state.user.uid ? 'Ejer' : ROLES[b.members?.[state.user.uid]] || '';
        return `<li class="${b.id === state.budgetId ? 'current' : ''}"><div><b>${esc(b.name)}</b>${b.settings?.demo ? ' <span class="chip warn">Eksempel</span>' : ''}<div class="muted small">${r} · ${Object.keys(b.members || {}).length} medlem(mer)</div></div>
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
      ${isAdmin() ? `<label class="check big-check bank-toggle"><input type="checkbox" id="ad-bankdays" ${state.budget.settings?.bankDays !== false ? 'checked' : ''}>
        <span>📅 <b>Regn med bankdage</b><br><span class="muted small">Falder en betaling i en weekend eller på en helligdag, trækkes den næste bankdag — og løn kommer bankdagen før. Bruges i Likviditet og "Du kan bruge".</span></span></label>` : ''}
      ${isAdmin() && feature('bank') ? `<label class="check big-check bank-toggle"><input type="checkbox" id="ad-bank" ${state.budget.settings?.bank ? 'checked' : ''}>
        <span>🏦 <b>Vis Bank-fanen i dette budget</b><br><span class="muted small">Så kan medlemmer koble deres bank på og se saldo og posteringer. Hver person vælger selv, hvilke konti der kommer med, og hvem der må se dem. Børn ("Kun læse") ser aldrig bankdata.</span></span></label>` : ''}
    </section>`;
  el.querySelector('#ad-new').onclick = async () => {
    const name = await promptDialog('Nyt budget', { label: 'Navn', placeholder: 'f.eks. Sommerhus, Budget 2027' });
    if (!name) return;
    try { const id = await createBudget(name); ui.selectBudget?.(id); toast('Budget oprettet'); } catch (e) { errorToast(e); }
  };
  el.querySelector('#ad-demo').onclick = async (e) => {
    e.target.disabled = true;
    try { const id = await createDemoBudget(); ui.selectBudget?.(id); } catch (err) { errorToast(err); } finally { e.target.disabled = false; }
  };
  el.querySelector('#ad-guide').onclick = () => showWelcome();
  el.querySelector('#ad-bankdays')?.addEventListener('change', (e) => {
    updateBudget({ 'settings.bankDays': e.target.checked }, e.target.checked ? 'Bankdage slået til' : 'Bankdage slået fra').then(() => toast('Gemt')).catch(errorToast);
  });
  el.querySelector('#ad-bank')?.addEventListener('change', (e) => {
    updateBudget({ 'settings.bank': e.target.checked }, e.target.checked ? 'Bank-fanen slået til' : 'Bank-fanen slået fra')
      .then(() => toast(e.target.checked ? 'Bank-fanen er slået til — du finder den i menuen' : 'Bank-fanen er slået fra'))
      .catch(errorToast);
  });
  el.querySelector('#ad-private').onclick = async () => {
    const name = await promptDialog('Nyt privat budget', { label: 'Navn', value: 'Min opsparing' });
    if (!name) return;
    try { const id = await createBudget(name); ui.selectBudget?.(id); toast('Privat budget oprettet — kun du kan se det'); } catch (e) { errorToast(e); }
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

// ---------- Udseende ----------
function look(el, root) {
  const p = getPrefs();
  const card = (t, slot) => `<button type="button" class="theme-card ${p[slot] === t.id ? 'on' : ''}" data-theme-pick="${t.id}" data-slot="${slot}">
      <span class="theme-swatch" style="background:${t.sw[0]}"><i style="background:${t.sw[1]};left:-10%;top:-20%"></i><i style="background:${t.sw[2]};right:-10%;top:0"></i><b style="background:${t.dark ? 'rgba(255,255,255,.1)' : 'rgba(255,255,255,.85)'};border:1px solid ${t.dark ? 'rgba(255,255,255,.15)' : 'rgba(0,0,0,.08)'}"></b></span>
      <span class="theme-name"><span>${t.name}</span>${p[slot] === t.id ? '<span>✓</span>' : ''}</span>
    </button>`;
  el.innerHTML = `
    <section class="glass card">
      <h2>☀️ Dag-tema</h2>
      <p class="muted small">Bruges om dagen, og når du trykker på solen øverst.</p>
      <div class="theme-grid">${THEMES.filter((t) => !t.dark).map((t) => card(t, 'day')).join('')}</div>
    </section>
    <section class="glass card">
      <h2>🌙 Nat-tema</h2>
      <p class="muted small">Bruges når du trykker på månen øverst.</p>
      <div class="theme-grid">${THEMES.filter((t) => t.dark).map((t) => card(t, 'night')).join('')}</div>
    </section>
    <section class="glass card simple-choice">
      <h2>Visning</h2>
      <div class="checks">
        <label class="check big-check"><input type="radio" name="viewMode" value="simple" ${p.simple ? 'checked' : ''}> ✨ Simpel — kun det vigtigste, ét spørgsmål ad gangen når man tilføjer</label>
        <label class="check big-check"><input type="radio" name="viewMode" value="full" ${p.simple ? '' : 'checked'}> 🧩 Udvidet — alle tal, filtre og indstillinger</label>
      </div>
      <p class="muted small">Indstillingerne gælder kun for dig og følger med til dine andre enheder. De andre i budgettet vælger selv.</p>
    </section>
    ${false ? `<section class="glass card">
      <h2>Skjulte bokse på budgetsiden</h2>
      <ul class="rows hidden-boxes">${p.hidden.map((h) => `<li><span>${esc({ funding: 'Status for overførsler til konti (gul/rød boks)', persons: 'Hvem betaler hvad' }[h] || h)}</span><button class="btn small ghost" data-unhide="${esc(h)}">Vis igen</button></li>`).join('')}</ul>
    </section>` : ''}`;
  el.querySelectorAll('[data-theme-pick]').forEach((b) => (b.onclick = async () => {
    const slot = b.dataset.slot;
    await setPrefs({ [slot]: b.dataset.themePick, mode: slot === 'night' ? 'night' : 'day' });
    render(root);
  }));
  el.querySelectorAll('[name=viewMode]').forEach((r) => (r.onchange = () => setPrefs({ simple: r.value === 'simple' })));
  el.querySelectorAll('[data-unhide]').forEach((b) => (b.onclick = async () => { await setPrefs({ hidden: (getPrefs().hidden || []).filter((x) => x !== b.dataset.unhide) }); render(root); }));
}

// ---------- Medlemmer ----------
function members(el, root) {
  const b = state.budget;
  const infoByEmail = new Map(Object.entries(b.memberInfo || {}).map(([uid, m]) => [m.email, { uid, ...m }]));
  const invites = [...(b.invites || [])].sort((x, y) => (y.at || 0) - (x.at || 0));
  const roleSel = (uid, cur) => `<select data-role="${uid}">${Object.entries(ROLES).map(([k, v]) => `<option value="${k}" ${k === cur ? 'selected' : ''}>${v}</option>`).join('')}</select>`;
  const appUrl = `${location.origin}${location.pathname}`;
  const mailto = (email) => `mailto:${esc(email)}?subject=${encodeURIComponent('Invitation til BudgetBasen')}&body=${encodeURIComponent(`Hej!\n\nJeg har inviteret dig til budgettet "${b.name}" i BudgetBasen.\nLog ind med din Google-konto (${email}) her: ${appUrl}\n`)}`;
  const dv = b.settings?.defaultVisibleTo;
  const dvAll = !Array.isArray(dv) || dv.includes(ALL);
  el.innerHTML = `
    <section class="glass card">
      <h2>Invitér en ny</h2>
      <form id="inv-form" class="inv-form">
        <label>Google-mail<input type="email" name="email" placeholder="fx maria@gmail.com" required autocomplete="off"></label>
        <label>Hvad må personen?<select name="role">${Object.entries(ROLES).map(([k, v]) => `<option value="${k}" ${k === 'edit' ? 'selected' : ''}>${v} — ${ROLE_HELP[k]}</option>`).join('')}</select></label>
        <button class="btn primary">📨 Invitér og send mail</button>
      </form>
      <p class="muted small">Personen får en mail med et link. Når de logger ind med den Google-konto, står der <b>Godkendt ✓</b> her.</p>
    </section>

    ${invites.length ? `<section class="glass card">
      <h2>Invitationer</h2>
      <ul class="rows">${invites.map((i) => {
        const joined = infoByEmail.get(i.email);
        const st = joined ? `<span class="chip ok">Godkendt ✓ ${joined.joinedAt ? fmtDate(new Date(joined.joinedAt)) : ''}</span>`
          : i.mailedAt ? `<span class="chip warn">Afventer · mail sendt ${fmtDate(new Date(i.mailedAt))}</span>`
          : '<span class="chip warn">Afventer · ingen mail sendt</span>';
        return `<li><div><b>${esc(i.email)}</b><div class="muted small">${ROLES[i.role]} · inviteret ${fmtDate(new Date(i.at))}</div>${st}</div>
          ${joined ? '' : `<div class="row-actions"><button class="btn small ghost" data-resend="${esc(i.email)}">Send igen</button><a class="btn small ghost" href="${mailto(i.email)}" title="Åbn din egen mail-app">Egen mail</a><button class="icon-btn" data-revoke="${esc(i.email)}" title="Tilbagekald">✕</button></div>`}</li>`;
      }).join('')}</ul>
    </section>` : ''}

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
        <p>${Object.entries(ROLES).map(([k, v]) => `<b>${v}</b>: ${ROLE_HELP[k]}`).join('<br>')}<br>
        Alle kan kun se de poster, kvitteringer og dokumenter, der er delt med dem — heller ikke admin kan se andres private ting.</p></details>
    </section>

    <section class="glass card">
      <h2>Hvem ser nye poster?</h2>
      <p class="muted small">Når nogen opretter en ny post, kvittering eller et dokument, er det som udgangspunkt synligt for: (det kan altid ændres på den enkelte post)</p>
      <div class="checks">
        <label class="check"><input type="radio" name="dvMode" value="all" ${dvAll ? 'checked' : ''}> Alle i budgettet</label>
        <label class="check"><input type="radio" name="dvMode" value="some" ${dvAll ? '' : 'checked'}> Kun disse personer (fx kun de voksne):</label>
        <div class="vis-members ${dvAll ? 'hidden' : ''}" id="dv-list">${Object.keys(b.members || {}).map((uid) => `<label class="check"><input type="checkbox" name="dvUid" value="${uid}" ${!dvAll && dv.includes(uid) ? 'checked' : ''}> ${esc(b.memberInfo?.[uid]?.name || uid)}</label>`).join('')}</div>
      </div>
      <button class="btn small primary" id="dv-save" type="button">Gem</button>
    </section>`;

  el.querySelector('#inv-form').onsubmit = async (e) => {
    e.preventDefault();
    const f = e.target;
    const btn = f.querySelector('button');
    btn.disabled = true;
    try {
      const res = await inviteMember(f.email.value, f.role.value);
      if (res === 'sent') toast('Invitation sendt på mail ✓');
      else {
        toast('Invitationen er oprettet — men mailen kunne ikke sendes automatisk. Brug "Egen mail".', 'error', 7000);
      }
      f.reset();
    } catch (err) { errorToast(err); } finally { btn.disabled = false; }
  };
  el.querySelectorAll('[data-resend]').forEach((btn) => (btn.onclick = async () => {
    btn.disabled = true;
    const res = await sendInvite(btn.dataset.resend);
    toast(res === 'sent' ? 'Mail sendt igen ✓' : 'Mailen kunne ikke sendes — brug "Egen mail"', res === 'sent' ? 'ok' : 'error');
    btn.disabled = false;
  }));
  el.querySelectorAll('[data-role]').forEach((x) => (x.onchange = () => setMemberRole(x.dataset.role, x.value).then(() => toast('Rolle opdateret')).catch(errorToast)));
  el.querySelectorAll('[data-remove]').forEach((x) => (x.onclick = async () => {
    const info = state.budget.memberInfo?.[x.dataset.remove];
    if (await confirmDialog(`Fjern <b>${esc(info?.name || '')}</b> fra budgettet?`)) removeMember(x.dataset.remove).catch(errorToast);
  }));
  el.querySelectorAll('[data-revoke]').forEach((x) => (x.onclick = () => revokeInvite(x.dataset.revoke).catch(errorToast)));
  el.querySelectorAll('[name=dvMode]').forEach((r) => (r.onchange = () => el.querySelector('#dv-list').classList.toggle('hidden', r.value !== 'some' || !r.checked)));
  el.querySelector('#dv-save').onclick = async () => {
    const mode = el.querySelector('[name=dvMode]:checked').value;
    const uids = [...el.querySelectorAll('[name=dvUid]:checked')].map((c) => c.value);
    const val = mode === 'all' || !uids.length ? [ALL] : uids;
    await updateDoc(budgetRef(), { 'settings.defaultVisibleTo': val, updatedAt: serverTimestamp() }).then(() => toast('Gemt')).catch(errorToast);
  };
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
        <h3>${esc(d.label)}</h3><p class="muted small">${esc(d.help || '')}</p>
        <div class="chips">${L[d.key].map((v) => {
          const n = usage(d.key, v);
          return `<span class="chip edit"><button class="link" data-rename="${d.key}" data-v="${esc(v)}">${esc(v)}</button>${n ? `<small>${n}</small>` : ''}<button class="x" data-del="${d.key}" data-v="${esc(v)}" aria-label="Slet">✕</button></span>`;
        }).join('') || '<span class="muted small">Tom</span>'}</div>
        <form class="inline-form" data-add="${d.key}"><input name="v" placeholder="Tilføj ${esc(d.single)}…" required><button class="btn small primary">Tilføj</button></form>
      </section>`).join('')}
    <section class="glass card list-card">
      <h3>Fælleskonti</h3>
      <p class="muted small">Poster på en fælleskonto tæller som fælles i "Hvem betaler hvad" og skal ikke fordeles i procent.</p>
      <div class="checks">${L.accounts.map((a) => `<label class="check"><input type="checkbox" name="jointAcc" value="${esc(a)}" ${jointAccounts().includes(a) ? 'checked' : ''}> ${esc(a)}</label>`).join('')}</div>
    </section>
    <section class="glass card list-card">
      <h3>Opsparingskonti 💵</h3>
      <p class="muted small">Overførsler til disse konti tæller som opsparing: de trækkes fra "Tilbage af lønnen" i det samlede budget, men ikke fra fx budgetkontoen.</p>
      <div class="checks">${L.accounts.map((a) => `<label class="check"><input type="checkbox" name="savAcc" value="${esc(a)}" ${savingsAccounts().includes(a) ? 'checked' : ''}> ${esc(a)}</label>`).join('')}</div>
    </section>
    <section class="glass card list-card">
      <h3>Betalingsfrekvenser</h3>
      <ul class="rows compact">${L.frequencies.map((f) => `<li><div><b>${esc(f.label)}</b> <span class="muted small">hver ${f.months}. måned · beløb ÷ ${f.months} = pr. md.</span></div>
        <div class="row-actions"><button class="btn small ghost" data-frename="${f.months}">Omdøb</button><button class="icon-btn" data-fdel="${f.months}">✕</button></div></li>`).join('')}</ul>
      <form class="inline-form" id="freq-form"><input name="months" type="number" min="1" max="120" placeholder="Måneder" required class="w-sm"><input name="label" placeholder="Navn, f.eks. Hver 18. måned"><button class="btn small primary">Tilføj</button></form>
    </section>`;

  el.querySelectorAll('[name=savAcc]').forEach((c) => (c.onchange = () => {
    const val = [...el.querySelectorAll('[name=savAcc]:checked')].map((x) => x.value);
    updateDoc(budgetRef(), { 'settings.savingsAccounts': val, updatedAt: serverTimestamp() }).then(() => toast('Opsparingskonti gemt')).catch(errorToast);
  }));
  el.querySelectorAll('[name=jointAcc]').forEach((c) => (c.onchange = () => {
    const val = [...el.querySelectorAll('[name=jointAcc]:checked')].map((x) => x.value);
    updateDoc(budgetRef(), { 'settings.jointAccounts': val, updatedAt: serverTimestamp() }).then(() => toast('Fælleskonti gemt')).catch(errorToast);
  }));
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
  const rowsHtml = () => {
    const q = ui.logFilter.toLowerCase();
    const rows = ui.log.rows.filter((r) => !q || [r.name, r.label, ENTITY[r.entity], ACTION[r.action]].some((x) => String(x || '').toLowerCase().includes(q)));
    return rows.map((r) => `<li class="log-${r.action}">
      <div class="log-time">${fmtDate(r.at, true)}</div>
      <div><b>${esc(r.name)}</b> ${ACTION[r.action] || r.action} ${ENTITY[r.entity] || r.entity} <b>${esc(r.label)}</b>
      ${r.changes ? `<div class="log-changes">${Object.entries(r.changes).map(([k, v]) => `${esc(k)}: <s>${esc(fmtVal(v.from))}</s> → ${esc(fmtVal(v.to))}`).join(' · ')}</div>` : ''}</div>
    </li>`).join('') || '<li class="muted">Ingen hændelser.</li>';
  };
  el.innerHTML = `<section class="glass card">
    <div class="section-head"><h2>Hvem har gjort hvad?</h2><button class="btn small ghost" id="log-refresh">Opdatér</button></div>
    <input id="log-q" type="search" placeholder="Søg på person, post eller handling…" value="${esc(ui.logFilter)}" autocomplete="off">
    <ul class="log" id="log-list">${rowsHtml()}</ul>
    <p class="muted small">Viser de seneste ${ui.log.rows.length} hændelser. Loggen kan ikke rettes eller slettes af nogen. Private ting vises uden navn.</p>
  </section>`;
  el.querySelector('#log-refresh').onclick = () => { ui.log = null; render(root); };
  const qi = el.querySelector('#log-q');
  qi.oninput = () => { ui.logFilter = qi.value; el.querySelector('#log-list').innerHTML = rowsHtml(); };
  qi.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); qi.blur(); } };
}
const fmtVal = (v) => (v === '' || v === null || v === undefined ? '–' : typeof v === 'number' ? kr(v) : typeof v === 'boolean' ? (v ? 'ja' : 'nej') : String(v));

// ---------- Eksport ----------
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
