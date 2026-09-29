// =====================================================================
//  app.js — indgangspunkt: login, valg af budget, navigation og invitationer.
// =====================================================================
import {
  db, auth, GoogleAuthProvider, signInWithPopup, signInWithRedirect, getRedirectResult, onAuthStateChanged, signOut,
  collection, query, where, onSnapshot, doc, setDoc, serverTimestamp,
} from './js/firebase.js';
import { state, emit, onChange, roleLabel } from './js/state.js';
import { $, $$, esc, toast, errorToast, lsGet, lsSet, firstName, confirmDialog } from './js/ui.js';
import { createBudget, loadMyInvites, acceptInvite, declineInvite, ensureAutoSnapshot, watchVisible } from './js/data.js';
import { maybeShowWelcome } from './js/help.js';
import * as budgetView from './js/views/budget.js';
import * as cashflowView from './js/views/cashflow.js';
import * as receiptsView from './js/views/receipts.js';
import * as documentsView from './js/views/documents.js';
import * as adminView from './js/views/admin.js';
import { renderPublicShare } from './js/views/share.js';

const VIEWS = { budget: budgetView, cashflow: cashflowView, receipts: receiptsView, documents: documentsView, admin: adminView };

// ---------- Start ----------
const shareToken = new URLSearchParams(location.search).get('share');
if (shareToken) renderPublicShare(shareToken);
else initApp();

function initApp() {
  registerServiceWorker();
  $('#btn-login').onclick = login;
  getRedirectResult(auth).catch((e) => e.code !== 'auth/no-auth-event' && errorToast(e));
  adminView.setSelectBudget(selectBudget);

  const hashView = location.hash.slice(1);
  state.view = VIEWS[hashView] ? hashView : lsGet('bb:view', 'budget');
  $$('#tabs [data-view]').forEach((b) => (b.onclick = () => setView(b.dataset.view)));
  window.addEventListener('hashchange', () => { const v = location.hash.slice(1); if (VIEWS[v] && v !== state.view) setView(v); });
  $('#budget-switch').onchange = (e) => selectBudget(e.target.value);
  $('#btn-user').onclick = userMenu;
  onChange(render);

  onAuthStateChanged(auth, async (user) => {
    cleanup();
    state.user = user;
    $('#splash').classList.add('hidden');
    if (!user) { $('#login').classList.remove('hidden'); $('#app').classList.add('hidden'); return; }
    $('#login').classList.add('hidden');
    $('#app').classList.remove('hidden');
    $('#avatar').src = user.photoURL || 'icons/icon.svg';
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

function render() {
  if (!state.user) return;
  renderInvites();
  $$('#tabs [data-view]').forEach((b) => b.classList.toggle('active', b.dataset.view === state.view));
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
    <button data-go="admin">⚙ Admin & indstillinger</button>
    <button data-logout>↪ Log ud</button>`;
  document.body.appendChild(m);
  m.querySelector('[data-go]').onclick = () => { m.remove(); setView('admin'); };
  m.querySelector('[data-logout]').onclick = async () => { m.remove(); await signOut(auth); location.hash = ''; };
  setTimeout(() => document.addEventListener('click', function off(e) { if (!m.contains(e.target)) { m.remove(); document.removeEventListener('click', off); } }), 0);
}

function registerServiceWorker() {
  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    navigator.serviceWorker.register('./sw.js').catch((e) => console.warn('SW', e));
  }
}
