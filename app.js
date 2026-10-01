// =====================================================================
//  app.js — indgangspunkt: login, valg af budget, navigation og invitationer.
// =====================================================================
import {
  db, auth, GoogleAuthProvider, signInWithPopup, signInWithRedirect, getRedirectResult, onAuthStateChanged, signOut,
  collection, query, where, onSnapshot, doc, setDoc, serverTimestamp,
} from './js/firebase.js';
import { state, emit, onChange, roleLabel, canEdit } from './js/state.js';
import { $, $$, esc, toast, errorToast, lsGet, lsSet, firstName, confirmDialog } from './js/ui.js';
import { createBudget, loadMyInvites, acceptInvite, declineInvite, ensureAutoSnapshot, watchVisible, createDemoBudget, resetDemoBudget, deleteBudgetCompletely } from './js/data.js';
import { maybeShowWelcome, setDemoHandler } from './js/help.js';
import { loadUserPrefs, toggleDayNight, onPrefs, getPrefs, setPrefs, isSimple } from './js/prefs.js';
import * as budgetView from './js/views/budget.js';
import * as cashflowView from './js/views/cashflow.js';
import * as receiptsView from './js/views/receipts.js';
import * as documentsView from './js/views/documents.js';
import * as adminView from './js/views/admin.js';
import { renderPublicShare } from './js/views/share.js';
import * as bankView from './js/views/bank.js';
import * as ownerView from './js/views/owner.js';
import { stashCallback } from './js/bank.js';
import { startConfig, onConfig, feature, getConfig, isAppOwner } from './js/config.js';

const VIEWS = { budget: budgetView, cashflow: cashflowView, receipts: receiptsView, documents: documentsView, bank: bankView, admin: adminView, owner: ownerView };
let pendingBankCallback = false;

// ---------- Start ----------
const shareToken = new URLSearchParams(location.search).get('share');
if (shareToken) renderPublicShare(shareToken);
else initApp();

function initApp() {
  registerServiceWorker();
  pendingBankCallback = stashCallback();
  startConfig();
  onConfig(() => { applyConfig(); $('#main').dataset.shell = ''; render(); });
  applyConfig();
  $('#btn-login').onclick = login;
  getRedirectResult(auth).catch((e) => e.code !== 'auth/no-auth-event' && errorToast(e));
  adminView.setSelectBudget(selectBudget);
  setDemoHandler(openDemo);

  const hashView = location.hash.slice(1);
  state.view = pendingBankCallback ? 'bank' : VIEWS[hashView] ? hashView : lsGet('bb:view', 'budget');
  $$('#tabs [data-view]').forEach((b) => (b.onclick = () => setView(b.dataset.view)));
  window.addEventListener('hashchange', () => { const v = location.hash.slice(1); if (VIEWS[v] && v !== state.view) setView(v); });
  $('#budget-switch').onchange = (e) => selectBudget(e.target.value);
  $('#btn-user').onclick = userMenu;
  $('#btn-daynight').onclick = () => toggleDayNight();
  const dn = () => { const n = getPrefs().mode === 'night'; $('#btn-daynight').textContent = n ? '☀️' : '🌙'; $('#btn-daynight').title = n ? 'Skift til dag' : 'Skift til nat'; };
  onPrefs(() => { dn(); $('#main').dataset.shell = ''; render(); });
  dn();
  onChange(render);

  onAuthStateChanged(auth, async (user) => {
    cleanup();
    state.user = user;
    $('#splash').classList.add('hidden');
    if (!user) { $('#login').classList.remove('hidden'); $('#app').classList.add('hidden'); return; }
    $('#login').classList.add('hidden');
    $('#app').classList.remove('hidden');
    $('#avatar').src = user.photoURL || 'icons/icon.svg';
    loadUserPrefs(user.uid);
    setDoc(doc(db, 'users', user.uid), {
      displayName: user.displayName || '', email: (user.email || '').toLowerCase(), photoURL: user.photoURL || '', lastLogin: serverTimestamp(),
    }, { merge: true }).catch(console.warn);
    try { state.invites = await loadMyInvites(); } catch (e) { console.warn(e); state.invites = []; }
    watchBudgets();
  });
}

async function login() {
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  try {
    await signInWithPopup(auth, provider);
  } catch (e) {
    if (['auth/popup-blocked', 'auth/operation-not-supported-in-environment', 'auth/web-storage-unsupported'].includes(e.code)) {
      await signInWithRedirect(auth, provider);
    } else if (!['auth/popup-closed-by-user', 'auth/cancelled-popup-request'].includes(e.code)) {
      errorToast(e);
    }
  }
}

function cleanup() {
  Object.values(state.unsubs).forEach((u) => (typeof u === 'function' ? u() : u?.fn?.()));
  state.unsubs = {};
  Object.assign(state, { budgets: [], budgetId: null, budget: null, items: [], itemsLoaded: false, col: {}, invites: [] });
}

// ---------- Budgetter ----------
/** "Lasses budget" / "Lars' budget" / "Mit budget" */
function ownBudgetName() {
  const n = firstName(state.user?.displayName);
  if (!n) return 'Mit budget';
  return /[sxz]$/i.test(n) ? `${n}' budget` : `${n}s budget`;
}
let creatingFirst = false;
function watchBudgets() {
  const q = query(collection(db, 'budgets'), where('memberUids', 'array-contains', state.user.uid));
  let first = true;
  state.unsubs.budgets = onSnapshot(q, async (snap) => {
    state.budgets = snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => a.name.localeCompare(b.name, 'da'));
    const wasFirst = first; first = false;

    // Ny bruger uden budgetter og uden invitationer → opret automatisk et privat, tomt workspace.
    if (!state.budgets.length) {
      state.budget = null; state.budgetId = null;
      if (wasFirst && !state.invites.length && !creatingFirst) {
        creatingFirst = true;
        try {
          const id = await createBudget(ownBudgetName());
          lsSet('bb:lastBudget', id);
          toast('Velkommen! Dit private budget er oprettet 🎉', 'ok', 5000);
        } catch (e) { errorToast(e); }
      }
      renderSwitcher(); emit();
      return;
    }

    if (wantedBudget && state.budgets.some((b) => b.id === wantedBudget)) { const w = wantedBudget; wantedBudget = null; selectBudget(w); return; }
    const current = state.budgets.find((b) => b.id === state.budgetId);
    if (current) { state.budget = current; renderSwitcher(); emit(); return; }
    const last = lsGet('bb:lastBudget', null);
    const pick = state.budgets.find((b) => b.id === last) || state.budgets.find((b) => b.ownerUid === state.user.uid) || state.budgets[0];
    selectBudget(pick.id);
  }, errorToast);
}

let wantedBudget = null; // budget der er oprettet/accepteret men endnu ikke kommet med i lytteren
function selectBudget(id) {
  const b = state.budgets.find((x) => x.id === id);
  if (!b) { wantedBudget = id; return; }
  if (state.budgetId !== id) {
    state.unsubs.items?.();
    Object.keys(state.unsubs).filter((k) => k.startsWith('col:')).forEach((k) => { state.unsubs[k]?.fn?.(); delete state.unsubs[k]; });
    state.col = {};
    state.items = []; state.itemsLoaded = false;
    state.budgetId = id;
    lsSet('bb:lastBudget', id);
    let firstItems = true;
    // Kun de poster brugeren må se (delte + dem der er delt med én selv)
    state.unsubs.items = watchVisible('items', (rows) => {
      state.items = rows;
      state.itemsLoaded = true;
      emit();
      if (firstItems) { firstItems = false; ensureAutoSnapshot(); }
    });
  }
  state.budget = b;
  renderSwitcher();
  emit();
  maybeShowWelcome();
}

function renderSwitcher() {
  const sel = $('#budget-switch');
  sel.innerHTML = state.budgets.map((b) => `<option value="${b.id}" ${b.id === state.budgetId ? 'selected' : ''}>${esc(b.name)}</option>`).join('');
  sel.classList.toggle('hidden', state.budgets.length === 0);
}

// ---------- Visning ----------
function setView(v) {
  state.view = v;
  lsSet('bb:view', v);
  if (location.hash.slice(1) !== v) history.replaceState(null, '', `#${v}`);
  window.scrollTo({ top: 0 });
  render();
}

/** Hvilke faner må vises lige nu (Ejer-admin-funktioner, simpel visning, budgettets bank-indstilling). */
function viewAllowed(v) {
  if (v === 'receipts') return feature('receipts');
  if (v === 'documents') return feature('documents') && !isSimple();
  if (v === 'bank') return feature('bank') && state.budget?.settings?.bank === true && canEdit();
  if (v === 'owner') return isAppOwner(state.user);
  return !!VIEWS[v];
}

/** Tekster og funktioner fra Ejer-admin, som ikke hører til en bestemt fane. */
function applyConfig() {
  const c = getConfig();
  const L = c.texts?.login || {};
  const tag = $('#login-tagline'); if (tag) { tag.dataset.def ??= tag.textContent; tag.textContent = L.tagline || tag.dataset.def; }
  const foot = $('#login-foot'); if (foot) { foot.dataset.def ??= foot.textContent; foot.textContent = L.foot || foot.dataset.def; }
  $$('#login-points li').forEach((li, i) => { li.dataset.def ??= li.textContent; li.textContent = L.points?.[i] || li.dataset.def; });
  document.body.classList.toggle('no-export', !feature('export'));
  document.body.classList.toggle('no-compare', !feature('compare'));
  document.body.classList.toggle('no-demo', !feature('demo'));
  document.body.classList.toggle('no-simple', !feature('simple'));
}

function renderAnnouncement() {
  const a = getConfig().announcement;
  const box = $('#announce');
  if (!a?.active || !a.text || lsGet(`bb:ann:${a.id}`, false)) { box.innerHTML = ''; return; }
  box.innerHTML = `<div class="announce ${a.level === 'warn' ? 'warn' : ''}"><span>${a.level === 'warn' ? '⚠️' : '📣'} ${esc(a.text)}</span><button class="icon-btn" aria-label="Luk beskeden">✕</button></div>`;
  box.querySelector('button').onclick = () => { lsSet(`bb:ann:${a.id}`, true); box.innerHTML = ''; };
}

function render() {
  if (!state.user) return;
  renderInvites();
  renderDemoBar();
  renderAnnouncement();
  document.body.classList.toggle('simple', isSimple());
  $$('#tabs [data-view]').forEach((b) => b.classList.toggle('hidden', !viewAllowed(b.dataset.view)));
  if (state.budget && !viewAllowed(state.view)) state.view = 'budget';
  $$('#tabs [data-view]').forEach((b) => b.classList.toggle('active', b.dataset.view === state.view));
  if (state.budget && pendingBankCallback) {
    pendingBankCallback = false;
    bankView.handleBankCallback(selectBudget, setView);
  }
  $('#role-badge').textContent = roleLabel();
  const main = $('#main');
  if (!state.budget) {
    main.innerHTML = state.budgets.length === 0 && !state.invites.length
      ? '<div class="skeleton"></div>'
      : state.invites.length ? '<div class="empty glass"><h3>Du har en invitation</h3><p>Acceptér den ovenfor — eller opret dit eget budget.</p><button class="btn ghost" id="own-budget">Opret mit eget budget</button></div>' : '';
    $('#own-budget')?.addEventListener('click', async () => { const id = await createBudget(ownBudgetName()); selectBudget(id); });
    return;
  }
  // Bevar fokus og markør i søgefelter når visningen gentegnes.
  const a = document.activeElement;
  const focusId = a && main.contains(a) ? a.id : null;
  const pos = focusId && typeof a.selectionStart === 'number' ? a.selectionStart : null;
  if (main.dataset.view !== state.view || main.dataset.budget !== state.budgetId) { main.dataset.shell = ''; main.dataset.view = state.view; main.dataset.budget = state.budgetId; }
  try { VIEWS[state.view].render(main); } catch (e) { console.error(e); main.innerHTML = `<div class="empty glass"><p>Der skete en fejl: ${esc(e.message)}</p></div>`; }
  if (focusId) { const n = document.getElementById(focusId); if (n) { n.focus(); if (pos !== null) try { n.setSelectionRange(pos, pos); } catch { /* ikke tekstfelt */ } } }
}

// ---------- Prøvebudget ----------
async function openDemo() {
  toast('Laver prøvebudgettet …', 'ok', 2500);
  try { const id = await createDemoBudget(); selectBudget(id); setView('budget'); }
  catch (e) { errorToast(e); }
}
function renderDemoBar() {
  const box = $('#demo-bar');
  const b = state.budget;
  if (!b?.settings?.demo) { box.innerHTML = ''; return; }
  const own = state.budgets.find((x) => !x.settings?.demo);
  box.innerHTML = `<div class="demo-bar">
    <span>📚 <b>Du kigger på et prøvebudget.</b> Tallene er opdigtede — prøv løs, du kan ikke ødelægge noget.</span>
    <span class="row-actions">
      ${own ? `<button class="btn small primary" data-demo="own">Gå til mit eget budget</button>` : ''}
      <button class="btn small ghost" data-demo="reset">↺ Nulstil eksemplet</button>
      ${b.ownerUid === state.user.uid ? '<button class="btn small danger-ghost" data-demo="delete">Slet prøvebudget</button>' : ''}
    </span></div>`;
  box.querySelector('[data-demo=own]')?.addEventListener('click', () => selectBudget(own.id));
  box.querySelector('[data-demo=reset]').onclick = async (e) => {
    if (!(await confirmDialog('Nulstil prøvebudgettet? Alt, du har ændret i eksemplet, bliver sat tilbage.', { okLabel: 'Nulstil', danger: false }))) return;
    e.target.disabled = true;
    try { await resetDemoBudget(b.id); toast('Prøvebudgettet er nulstillet'); } catch (err) { errorToast(err); } finally { e.target.disabled = false; }
  };
  box.querySelector('[data-demo=delete]')?.addEventListener('click', async () => {
    if (!(await confirmDialog('Slet prøvebudgettet? Du kan altid lave et nyt under Admin → Budgetter.', { okLabel: 'Slet' }))) return;
    try { await deleteBudgetCompletely(b); if (own) selectBudget(own.id); } catch (err) { errorToast(err); }
  });
}

function renderInvites() {
  const box = $('#invite-banner');
  box.innerHTML = state.invites.map((inv) => `
    <div class="invite glass">
      <span>📨 <b>${esc(inv.invitedBy)}</b> har inviteret dig til <b>${esc(inv.budgetName)}</b> som ${inv.role === 'admin' ? 'admin' : inv.role === 'edit' ? 'redaktør' : 'læser'}.</span>
      <span class="row-actions"><button class="btn small primary" data-accept="${esc(inv.id)}">Acceptér</button><button class="btn small ghost" data-decline="${esc(inv.id)}">Afvis</button></span>
    </div>`).join('');
  box.querySelectorAll('[data-accept]').forEach((b) => (b.onclick = async () => {
    const inv = state.invites.find((i) => i.id === b.dataset.accept);
    b.disabled = true;
    try {
      await acceptInvite(inv);
      state.invites = state.invites.filter((i) => i !== inv);
      lsSet('bb:lastBudget', inv.budgetId);
      toast(`Du er nu med i ${inv.budgetName}`);
      selectBudget(inv.budgetId);
      emit();
    } catch (e) { b.disabled = false; errorToast(e); }
  }));
  box.querySelectorAll('[data-decline]').forEach((b) => (b.onclick = async () => {
    const inv = state.invites.find((i) => i.id === b.dataset.decline);
    if (!(await confirmDialog(`Afvis invitationen til <b>${esc(inv.budgetName)}</b>?`))) return;
    await declineInvite(inv).catch(errorToast);
    state.invites = state.invites.filter((i) => i !== inv);
    if (!state.budgets.length) { const id = await createBudget(ownBudgetName()); selectBudget(id); }
    emit();
  }));
}

function userMenu() {
  const u = state.user;
  const existing = $('.user-menu');
  if (existing) { existing.remove(); return; }
  const m = document.createElement('div');
  m.className = 'user-menu glass';
  m.innerHTML = `<div class="um-head"><b>${esc(u.displayName || '')}</b><span class="muted small">${esc(u.email || '')}</span></div>
    <button data-simple class="${feature('simple') ? '' : 'hidden'}">${isSimple() ? '🧩 Skift til udvidet visning' : '✨ Skift til simpel visning'}</button>
    <button data-look>🎨 Udseende</button>
    <button data-go="admin">⚙ Admin & indstillinger</button>
    ${isAppOwner(u) ? '<button data-owner>👑 Ejer-admin</button>' : ''}
    <button data-logout>↪ Log ud</button>`;
  document.body.appendChild(m);
  m.querySelector('[data-go]').onclick = () => { m.remove(); setView('admin'); };
  m.querySelector('[data-simple]').onclick = () => { m.remove(); setPrefs({ simple: !isSimple() }); toast(isSimple() ? 'Simpel visning er slået til' : 'Udvidet visning er slået til'); };
  m.querySelector('[data-owner]')?.addEventListener('click', () => { m.remove(); setView('owner'); });
  m.querySelector('[data-look]').onclick = () => { m.remove(); adminView.openTab('look'); setView('admin'); };
  m.querySelector('[data-logout]').onclick = async () => { m.remove(); await signOut(auth); location.hash = ''; };
  setTimeout(() => document.addEventListener('click', function off(e) { if (!m.contains(e.target)) { m.remove(); document.removeEventListener('click', off); } }), 0);
}

function registerServiceWorker() {
  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    navigator.serviceWorker.register('./sw.js').catch((e) => console.warn('SW', e));
  }
}
