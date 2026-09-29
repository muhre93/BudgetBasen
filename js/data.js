// Al kommunikation med Firestore samlet her.
import {
  db, collection, doc, getDoc, getDocs, setDoc, addDoc, updateDoc, deleteDoc, onSnapshot,
  query, where, orderBy, limit, serverTimestamp, writeBatch, arrayUnion, arrayRemove, deleteField,
} from './firebase.js';
import { state, emit, lists, defaultLists, canEdit } from './state.js';
import { firstName, isoDate, currentYm, fmtYm, errorToast, toast, esc } from './ui.js';
import { freqLabel } from './calc.js';
import { removeFile, purgeBudgetFiles } from './files.js';

export const budgetRef = (id = state.budgetId) => doc(db, 'budgets', id);
export const sub = (name, id = state.budgetId) => collection(db, 'budgets', id, name);

const me = () => ({
  uid: state.user.uid,
  name: state.user.displayName || state.user.email,
  email: (state.user.email || '').toLowerCase(),
  photo: state.user.photoURL || '',
});

// ---------- Log ----------
export async function logAction(action, entity, label, changes = null, budgetId = state.budgetId) {
  try {
    await addDoc(sub('log', budgetId), {
      at: serverTimestamp(), uid: state.user.uid, name: me().name,
      action, entity, label: String(label || ''), changes,
    });
  } catch (e) { console.warn('Log fejlede', e); }
}

const LOG_FIELDS = { name: 'Navn', amount: 'Beløb', freq: 'Frekvens', category: 'Kategori', who: 'Hvem', supplier: 'Leverandør', method: 'Metode', account: 'Konto', startMonth: 'Første betaling', payDay: 'Betalingsdag', endMonth: 'Slutter', note: 'Note', active: 'Aktiv', private: 'Privat', type: 'Type', store: 'Butik', date: 'Dato', title: 'Titel', expiryDate: 'Udløb' };
export function diffFields(oldObj = {}, newObj = {}) {
  const out = {};
  for (const k of Object.keys(LOG_FIELDS)) {
    if (!(k in newObj)) continue;
    const a = oldObj[k] ?? '', b = newObj[k] ?? '';
    if (String(a) !== String(b)) out[LOG_FIELDS[k]] = { from: k === 'freq' ? freqLabel(a) : a, to: k === 'freq' ? freqLabel(b) : b };
  }
  return Object.keys(out).length ? out : null;
}

// ---------- Budgetter ----------
export async function createBudget(name, { copyFromId = null } = {}) {
  const u = me();
  const ref = doc(collection(db, 'budgets'));
  let listsData = defaultLists(firstName(u.name));
  let settings = { balances: [{ account: 'Budgetkonto', amount: 0, date: isoDate() }] };
  let items = [];
  if (copyFromId) {
    const src = state.budgets.find((b) => b.id === copyFromId);
    if (src?.lists) listsData = src.lists;
    if (src?.settings) settings = src.settings;
    items = (await getDocs(sub('items', copyFromId))).docs.map((d) => d.data());
  }
  await setDoc(ref, {
    name, ownerUid: u.uid,
    members: { [u.uid]: 'admin' },
    memberUids: [u.uid],
    memberInfo: { [u.uid]: { name: u.name, email: u.email, photo: u.photo } },
    invites: [], shares: [],
    lists: listsData, settings,
    createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
  });
  if (items.length) {
    for (let i = 0; i < items.length; i += 400) {
      const b = writeBatch(db);
      items.slice(i, i + 400).forEach((it) => b.set(doc(sub('items', ref.id)), { ...it, createdAt: serverTimestamp(), createdBy: u.uid }));
      await b.commit();
    }
  }
  await logAction('create', 'budget', name, copyFromId ? { Kopieret: { from: '', to: `${items.length} poster` } } : null, ref.id);
  return ref.id;
}

export async function updateBudget(patch, logLabel = null) {
  await updateDoc(budgetRef(), { ...patch, updatedAt: serverTimestamp() });
  if (logLabel) logAction('update', 'settings', logLabel);
}

export async function saveBalances(balances) {
  const old = state.budget.settings?.balances || [];
  await updateDoc(budgetRef(), { 'settings.balances': balances, updatedAt: serverTimestamp() });
  const changes = {};
  for (const b of balances) {
    const o = old.find((x) => x.account === b.account);
    if (!o || o.amount !== b.amount) changes[b.account] = { from: o?.amount ?? '', to: b.amount };
  }
  if (Object.keys(changes).length) logAction('update', 'balance', 'Kontosaldo', changes);
}

export async function addListValue(key, value) {
  const v = String(value || '').trim();
  if (!v) return null;
  const L = lists();
  if (L[key].some((x) => x.toLowerCase() === v.toLowerCase())) return L[key].find((x) => x.toLowerCase() === v.toLowerCase());
  await updateDoc(budgetRef(), { [`lists.${key}`]: [...L[key], v], updatedAt: serverTimestamp() });
  logAction('create', 'list', `${key}: ${v}`);
  return v;
}

export async function addFrequency(months, label) {
  const L = lists();
  months = Math.round(Number(months));
  if (!(months >= 1 && months <= 120)) throw new Error('Antal måneder skal være mellem 1 og 120');
  if (L.frequencies.some((f) => f.months === months)) return months;
  await updateDoc(budgetRef(), { 'lists.frequencies': [...L.frequencies, { months, label: label || freqLabel(months, []) }], updatedAt: serverTimestamp() });
  logAction('create', 'list', `Frekvens: ${label || months}`);
  return months;
}

/** Omdøb en listeværdi og opdatér alle poster/kvitteringer/dokumenter der bruger den. */
const CASCADE = {
  categories: [['items', 'category'], ['receipts', 'category']],
  people: [['items', 'who'], ['receipts', 'who']],
  suppliers: [['items', 'supplier'], ['receipts', 'store'], ['documents', 'supplier']],
  methods: [['items', 'method']],
  accounts: [['items', 'account']],
  docTypes: [['documents', 'docType']],
};
export async function renameListValue(key, oldV, newV) {
  newV = String(newV || '').trim();
  if (!newV || newV === oldV) return 0;
  const L = lists();
  const patch = { [`lists.${key}`]: L[key].map((x) => (x === oldV ? newV : x)), updatedAt: serverTimestamp() };
  if (key === 'accounts') patch['settings.balances'] = (state.budget.settings?.balances || []).map((b) => (b.account === oldV ? { ...b, account: newV } : b));
  await updateDoc(budgetRef(), patch);
  let n = 0;
  for (const [colName, field] of CASCADE[key] || []) {
    const snap = await getDocs(query(sub(colName), where(field, '==', oldV)));
    for (let i = 0; i < snap.docs.length; i += 400) {
      const b = writeBatch(db);
      snap.docs.slice(i, i + 400).forEach((d) => b.update(d.ref, { [field]: newV }));
      await b.commit();
    }
    n += snap.size;
  }
  logAction('update', 'list', `${key}: ${oldV} → ${newV}`, n ? { Opdateret: { from: '', to: `${n} poster` } } : null);
  return n;
}

export async function removeListValue(key, value) {
  const L = lists();
  await updateDoc(budgetRef(), { [`lists.${key}`]: L[key].filter((x) => x !== value), updatedAt: serverTimestamp() });
  logAction('delete', 'list', `${key}: ${value}`);
}

// ---------- Budgetposter ----------
export async function saveItem(id, data, old = null) {
  const base = { ...data, updatedAt: serverTimestamp(), updatedBy: state.user.uid };
  if (id) {
    await updateDoc(doc(sub('items'), id), base);
    logAction('update', 'item', data.name, diffFields(old || {}, data));
    return id;
  }
  const ref = await addDoc(sub('items'), { ...base, createdAt: serverTimestamp(), createdBy: state.user.uid });
  logAction('create', 'item', data.name, { Beløb: { from: '', to: data.amount } });
  return ref.id;
}
export async function deleteItem(item) {
  await deleteDoc(doc(sub('items'), item.id));
  logAction('delete', 'item', item.name, { Beløb: { from: item.amount, to: '' } });
}

// ---------- Kvitteringer & dokumenter (generisk) ----------
export async function saveRecord(colName, id, data, old = null) {
  const base = { ...data, updatedAt: serverTimestamp(), updatedBy: state.user.uid };
  const entity = colName === 'receipts' ? 'receipt' : 'document';
  const label = data.title || [data.store, data.what].filter(Boolean).join(' – ') || 'Uden navn';
  if (id) {
    await updateDoc(doc(sub(colName), id), base);
    logAction('update', entity, label, diffFields(old || {}, data));
    return id;
  }
  const ref = await addDoc(sub(colName), { ...base, createdAt: serverTimestamp(), createdBy: state.user.uid, createdByName: me().name });
  logAction('create', entity, label);
  return ref.id;
}
export async function deleteRecord(colName, rec) {
  const files = rec.files || (rec.file ? [rec.file] : []);
  for (const f of files) await removeFile(f).catch((e) => console.warn(e));
  await deleteDoc(doc(sub(colName), rec.id));
  logAction('delete', colName === 'receipts' ? 'receipt' : 'document', rec.title || rec.store || '');
}

/** Lazy lyt på en under-samling (receipts/documents) for aktivt budget. */
export function watch(colName) {
  const key = `${state.budgetId}:${colName}`;
  if (state.unsubs[`col:${colName}`]?.key === key) return;
  state.unsubs[`col:${colName}`]?.fn?.();
  state.col[colName] = null;
  const fn = onSnapshot(sub(colName), (snap) => {
    state.col[colName] = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    emit();
  }, errorToast);
  state.unsubs[`col:${colName}`] = { key, fn };
}

// ---------- Versioner (snapshots) ----------
const cleanItem = ({ createdAt, updatedAt, createdBy, updatedBy, ...rest }) => rest;
export async function saveSnapshot(name, auto = false) {
  const data = {
    name, auto, createdAt: serverTimestamp(), createdBy: state.user.uid, createdByName: me().name,
    items: state.items.map(cleanItem), balances: state.budget.settings?.balances || [],
  };
  if (auto) { await setDoc(doc(sub('snapshots'), `auto_${currentYm()}`), data); }
  else { await addDoc(sub('snapshots'), data); logAction('create', 'snapshot', name); }
}
/** Gem automatisk én version pr. måned (første gang budgettet åbnes i måneden). */
export async function ensureAutoSnapshot() {
  if (!canEdit() || !state.items.length) return;
  const id = `auto_${currentYm()}`;
  const flag = `bb:auto:${state.budgetId}:${id}`;
  if (sessionStorage.getItem(flag)) return;
  try {
    const s = await getDoc(doc(sub('snapshots'), id));
    if (!s.exists()) await saveSnapshot(`Auto · ${fmtYm(currentYm(), true)}`, true);
    sessionStorage.setItem(flag, '1');
  } catch (e) { console.warn('Auto-version fejlede', e); }
}
export async function listSnapshots(budgetId = state.budgetId) {
  const snap = await getDocs(query(sub('snapshots', budgetId), orderBy('createdAt', 'desc'), limit(60)));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}
export const deleteSnapshot = (id) => deleteDoc(doc(sub('snapshots'), id));

export async function loadLog(n = 200) {
  const snap = await getDocs(query(sub('log'), orderBy('at', 'desc'), limit(n)));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

// ---------- Medlemmer & invitationer ----------
export async function inviteMember(email, role) {
  email = String(email).trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error('Ugyldig e-mail');
  if (Object.values(state.budget.memberInfo || {}).some((m) => m.email === email)) throw new Error('Personen er allerede medlem');
  const u = me();
  await setDoc(doc(db, 'invites', `${state.budgetId}_${email}`), {
    email, role, budgetId: state.budgetId, budgetName: state.budget.name,
    invitedBy: u.name, invitedByUid: u.uid, createdAt: serverTimestamp(),
  });
  const invites = (state.budget.invites || []).filter((i) => i.email !== email);
  await updateDoc(budgetRef(), { invites: [...invites, { email, role, at: Date.now() }], updatedAt: serverTimestamp() });
  logAction('create', 'member', `Inviterede ${email}`, { Rolle: { from: '', to: role } });
}
export async function revokeInvite(email) {
  await deleteDoc(doc(db, 'invites', `${state.budgetId}_${email}`)).catch(() => {});
  await updateDoc(budgetRef(), { invites: (state.budget.invites || []).filter((i) => i.email !== email), updatedAt: serverTimestamp() });
  logAction('delete', 'member', `Tilbagekaldte invitation til ${email}`);
}
export async function setMemberRole(uid, role) {
  const info = state.budget.memberInfo?.[uid];
  const from = state.budget.members[uid];
  await updateDoc(budgetRef(), { [`members.${uid}`]: role, updatedAt: serverTimestamp() });
  logAction('update', 'member', info?.name || uid, { Rolle: { from, to: role } });
}
export async function removeMember(uid) {
  const info = state.budget.memberInfo?.[uid];
  await updateDoc(budgetRef(), {
    [`members.${uid}`]: deleteField(), [`memberInfo.${uid}`]: deleteField(),
    memberUids: arrayRemove(uid), updatedAt: serverTimestamp(),
  });
  logAction('delete', 'member', `Fjernede ${info?.name || uid}`);
}
export async function leaveBudget() {
  const uid = state.user.uid;
  await logAction('delete', 'member', `${me().name} forlod budgettet`);
  await updateDoc(budgetRef(), { [`members.${uid}`]: deleteField(), [`memberInfo.${uid}`]: deleteField(), memberUids: arrayRemove(uid) });
}

export async function loadMyInvites() {
  const email = (state.user.email || '').toLowerCase();
  if (!email) return [];
  const snap = await getDocs(query(collection(db, 'invites'), where('email', '==', email)));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}
export async function acceptInvite(inv) {
  const u = me();
  // Reglerne tjekker at invitationen findes og at rollen matcher.
  await updateDoc(doc(db, 'budgets', inv.budgetId), {
    [`members.${u.uid}`]: inv.role,
    memberUids: arrayUnion(u.uid),
    [`memberInfo.${u.uid}`]: { name: u.name, email: u.email, photo: u.photo },
  });
  await deleteDoc(doc(db, 'invites', inv.id)).catch(() => {});
  await logAction('create', 'member', `${u.name} accepterede invitationen`, null, inv.budgetId);
}
export const declineInvite = (inv) => deleteDoc(doc(db, 'invites', inv.id));

// ---------- Slet hele budgettet (kun ejer) ----------
export async function deleteBudgetCompletely(budget) {
  const id = budget.id;
  // 1) Alle filer i Cloudflare KV (skal ske mens budgettet findes, så Worker'en kan tjekke ejerskab)
  try { await purgeBudgetFiles(id); } catch (e) { console.warn('Filer kunne ikke slettes', e); }
  for (const colName of ['items', 'receipts', 'documents', 'snapshots', 'log']) {
    const snap = await getDocs(sub(colName, id));
    for (let i = 0; i < snap.docs.length; i += 400) {
      const b = writeBatch(db);
      snap.docs.slice(i, i + 400).forEach((d) => b.delete(d.ref));
      await b.commit();
    }
  }
  for (const inv of budget.invites || []) await deleteDoc(doc(db, 'invites', `${id}_${inv.email}`)).catch(() => {});
  for (const s of budget.shares || []) await deleteDoc(doc(db, 'shares', s.token)).catch(() => {});
  await deleteDoc(doc(db, 'budgets', id));
  toast(`"${budget.name}" er slettet`);
}
