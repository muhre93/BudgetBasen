// Bank-data: kald til Worker'en (Enable Banking) + gemning i Firestore.
//
// Firestore (under budgettet):
//   bankAccounts/{nøgle}   én konto. Nøglen er en hemmelig fingeraftryks-kode af kontonummeret,
//                          lavet af Worker'en — så den samme fælleskonto får samme nøgle hos begge.
//                          owners: de brugere der har koblet kontoen på. visibleTo: owners (+ 'adults').
//   bankTx/{nøgle}_{ÅÅÅÅ-MM}  posteringerne for én måned.
import { db, doc, getDoc, setDoc, updateDoc, deleteDoc, onSnapshot, query, where, arrayUnion, serverTimestamp, writeBatch } from './firebase.js';
import { state, canEdit, jointAccounts } from './state.js';
import { workerFetch } from './files.js';
import { sub, saveBalances } from './data.js';
import { isoDate, firstName } from './ui.js';

export const ADULTS = 'adults';

export async function bankApi(path, { method = 'GET', body } = {}) {
  const res = await workerFetch(`/bank${path}`, {
    method, body: body ? JSON.stringify(body) : undefined,
    headers: body ? { 'Content-Type': 'application/json' } : {},
  });
  return res.json();
}

/** Den adresse banken skal sende brugeren tilbage til (skal stå i Enable Banking-appen). */
export const appRedirect = () => location.origin + location.pathname.replace(/index\.html$/, '');

// ---------- Konti ----------
export function watchBankAccounts(onData, onError) {
  const parts = { mine: null, adults: canEdit() ? null : [] };
  const conv = (s) => s.docs.map((d) => ({ id: d.id, ...d.data() }));
  const push = () => {
    if (!parts.mine || !parts.adults) return;
    const m = new Map();
    for (const a of [...parts.mine, ...parts.adults]) m.set(a.id, a);
    onData([...m.values()].sort((a, b) => (a.name || '').localeCompare(b.name || '', 'da')));
  };
  const u1 = onSnapshot(query(sub('bankAccounts'), where('visibleTo', 'array-contains', state.user.uid)), (s) => { parts.mine = conv(s); push(); }, onError);
  const u2 = canEdit() ? onSnapshot(query(sub('bankAccounts'), where('visibleTo', 'array-contains', ADULTS)), (s) => { parts.adults = conv(s); push(); }, onError) : () => {};
  return () => { u1(); u2(); };
}

const acctRef = (key) => doc(sub('bankAccounts'), key);
const txRef = (key, ym) => doc(sub('bankTx'), `${key}_${ym}`);

/**
 * Gem de konti brugeren har valgt efter MitID-login.
 * choices: [{ key, name, masked, currency, budgetAccount, shareAdults }]
 * Findes kontoen allerede (fx fordi din partner har koblet den samme fælleskonto på), bliver du medejer.
 */
async function joinHash(proof) {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(proof)));
  return [...d].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function linkAccounts(choices, { bank, validUntil }) {
  const me = state.user.uid;
  const myName = firstName(state.user.displayName) || 'Mig';
  const results = [];
  for (const c of choices) {
    const ref = acctRef(c.key);
    let snap = null, hidden = false;
    try { snap = await getDoc(ref); } catch (e) { if (e.code === 'permission-denied' || /permission/i.test(e.message)) hidden = true; else throw e; }
    const linked = { [me]: { bank, validUntil: validUntil || null, at: isoDate() } };
    if (!hidden && (!snap || !snap.exists())) {
      await setDoc(ref, {
        key: c.key, name: c.name, label: c.label || '', bank, masked: c.masked || '', currency: c.currency || 'DKK',
        owners: [me], ownerNames: { [me]: myName }, linked, joinHash: await joinHash(c.proof),
        visibleTo: c.shareAdults ? [me, ADULTS] : [me],
        budgetAccount: c.budgetAccount || '', months: [], createdAt: serverTimestamp(),
      });
      results.push({ key: c.key, status: 'new' });
    } else if (!hidden && snap.data().owners?.includes(me)) {
      await updateDoc(ref, { [`linked.${me}`]: linked[me] });
      results.push({ key: c.key, status: 'renewed' });
    } else {
      // Kontoen findes allerede hos en anden i budgettet → fælles konto.
      // Beviset (fra Worker'en) gemmes et sted ingen kan læse, og reglerne tjekker det.
      const b = writeBatch(db);
      b.set(doc(sub('bankJoins'), `${c.key}_${me}`), { key: c.key, proof: c.proof, at: serverTimestamp() });
      b.set(ref, { owners: arrayUnion(me), ownerNames: { [me]: myName }, linked, visibleTo: arrayUnion(me) }, { merge: true });
      await b.commit();
      results.push({ key: c.key, status: 'joint' });
      const fresh = (await getDoc(ref)).data();
      // Gør de måneder, partneren allerede har hentet, synlige for dig også
      if (fresh.months?.length) {
        const vb = writeBatch(db);
        for (const ym of fresh.months) vb.update(txRef(c.key, ym), { visibleTo: fresh.visibleTo });
        await vb.commit().catch((e) => console.warn('months', e));
      }
      const ba = fresh.budgetAccount || c.budgetAccount;
      if (ba && canEdit() && !jointAccounts().includes(ba)) {
        await updateDoc(doc(db, 'budgets', state.budgetId), { 'settings.jointAccounts': [...jointAccounts(), ba] }).catch(() => {});
      }
      if (!fresh.budgetAccount && c.budgetAccount) await updateDoc(ref, { budgetAccount: c.budgetAccount }).catch(() => {});
    }
  }
  return results;
}

export async function setBudgetAccount(acct, budgetAccount) {
  await updateDoc(acctRef(acct.id), { budgetAccount });
  if (!canEdit()) return;
  if (budgetAccount && acct.balance != null) await queueBalance(budgetAccount, acct.balance, acct.id);
  else await dropBalance(acct.id);
}
/** Giv bankkontoen dit eget navn (kun ejere). */
export async function renameAccount(acct, label) {
  await updateDoc(acctRef(acct.id), { label: String(label || '').trim().slice(0, 40) });
}
/** Det navn der vises: eget navn → budgetkonto + sidste cifre → bankens navn. */
export const acctLabel = (a) => a?.label || (a?.budgetAccount ? `${a.budgetAccount}${a.masked ? ` ${a.masked.replace('•••• ', '··')}` : ''}` : `${a?.name || 'Konto'}${a?.masked ? ` ${a.masked.replace('•••• ', '··')}` : ''}`);

/** Skift hvem der må se kontoen (og alle dens måneder). */
export async function setVisibility(acct, shareAdults) {
  const vis = shareAdults ? [...new Set([...acct.owners, ADULTS])] : [...acct.owners];
  const b = writeBatch(db);
  b.update(acctRef(acct.id), { visibleTo: vis });
  for (const ym of acct.months || []) b.update(txRef(acct.id, ym), { visibleTo: vis });
  await b.commit();
}

/** Fjern kontoen fra budgettet (eller kun dig selv, hvis det er en fælleskonto). */
export async function unlinkAccount(acct) {
  const me = state.user.uid;
  if ((acct.owners || []).length <= 1) {
    for (const ym of acct.months || []) await deleteDoc(txRef(acct.id, ym)).catch(() => {});
    await deleteDoc(acctRef(acct.id));
    await dropBalance(acct.id);
    return 'deleted';
  }
  const owners = acct.owners.filter((u) => u !== me);
  const ownerNames = { ...acct.ownerNames }; delete ownerNames[me];
  const linked = { ...acct.linked }; delete linked[me];
  const vis = acct.visibleTo.includes(ADULTS) ? [...owners, ADULTS] : owners;
  const b = writeBatch(db);
  for (const ym of acct.months || []) b.update(txRef(acct.id, ym), { visibleTo: vis });
  b.update(acctRef(acct.id), { owners, ownerNames, linked, visibleTo: vis });
  await b.commit();
  return 'left';
}

// ---------- Posteringer ----------
const cache = new Map(); // `${key}_${ym}` → txs
export async function loadMonths(acct, yms) {
  const out = [];
  await Promise.all(yms.map(async (ym) => {
    const id = `${acct.id}_${ym}|${acct.syncedAt || ''}`;
    if (!(acct.months || []).includes(ym)) return;
    if (!cache.has(id)) {
      try { const s = await getDoc(txRef(acct.id, ym)); cache.set(id, s.exists() ? s.data().txs || [] : []); } catch { cache.set(id, []); }
    }
    out.push(...cache.get(id));
  }));
  return out.sort((a, b) => b.date.localeCompare(a.date));
}
export const clearTxCache = () => cache.clear();

const TXV = 3; // version af posteringsformatet — ved ny version hentes alt igen (fx rettet fortegn)

/** Hent nyt fra banken for én konto og gem det. Returnerer { balance, count }. */
export async function syncAccount(acct) {
  const me = state.user.uid;
  if (!acct.owners?.includes(me)) throw new Error('Kun den der har koblet kontoen på, kan hente nyt');
  const known = (acct.months || []).slice().sort();
  const full = acct.txv !== TXV || !known.length || !acct.syncedAt;
  const dateFrom = full
    ? isoDate(new Date(Date.now() - 365 * 864e5))
    : isoDate(new Date(Math.min(Date.now() - 10 * 864e5, (acct.syncedAt?.toMillis?.() ?? acct.syncedAt) - 7 * 864e5)));
  const r = await bankApi('/sync', { method: 'POST', body: { key: acct.id, dateFrom } });
  const from = r.from || dateFrom;
  const byMonth = new Map();
  for (const t of r.transactions || []) {
    if (!t.date) continue;
    const ym = t.date.slice(0, 7);
    if (!byMonth.has(ym)) byMonth.set(ym, []);
    byMonth.get(ym).push(t);
  }
  // Ved fuld hentning erstattes også måneder, hvor banken nu ikke sender noget
  if (full) for (const ym of known) if (ym >= from.slice(0, 7) && !byMonth.has(ym)) byMonth.set(ym, []);
  const months = new Set(known);
  for (const [ym, list] of byMonth) {
    let old = [];
    try { const s = await getDoc(txRef(acct.id, ym)); if (s.exists()) old = s.data().txs || []; } catch (e) { console.warn('kan ikke læse', ym, e); continue; } // overskriv aldrig noget, vi ikke kan se
    // Banken sender ALT fra "from" og frem → det gamle i det tidsrum erstattes helt (ventende og rettede posteringer forsvinder korrekt)
    const map = new Map(old.filter((t) => t.date < from).map((t) => [t.id, t]));
    for (const t of list) map.set(t.id, t);
    const txs = [...map.values()].sort((a, b) => a.date.localeCompare(b.date));
    if (!txs.length && !old.length) continue;
    await setDoc(txRef(acct.id, ym), { acct: acct.id, ym, txs, visibleTo: acct.visibleTo, updatedAt: serverTimestamp() });
    months.add(ym);
  }
  const allDates = (r.transactions || []).map((t) => t.date).filter(Boolean).sort();
  const dataFrom = [acct.dataFrom, allDates[0]].filter(Boolean).sort()[0] || null;
  const bal = r.balance || {};
  await updateDoc(acctRef(acct.id), {
    balance: bal.amount ?? null, available: bal.available ?? null, balanceAt: bal.at || isoDate(),
    syncedAt: Date.now(), months: [...months].sort(), txv: TXV, dataFrom, requestedFrom: full ? from : (acct.requestedFrom || from),
    [`linked.${me}.validUntil`]: r.validUntil || null,
  });
  // Saldoen bruges automatisk i budgettet ("Du kan bruge …" og Likviditet)
  if (acct.budgetAccount && bal.amount != null && canEdit()) await queueBalance(acct.budgetAccount, bal.amount, acct.id);
  return { balance: bal.amount, count: (r.transactions || []).length };
}

// Flere konti kan hentes samtidig — saldoerne skrives én ad gangen med friske data, så de ikke overskriver hinanden.
// Hører flere bankkonti til samme konto i budgettet, lægges de sammen (parts: { banknøgle: beløb }).
let balQueue = Promise.resolve();
function queueBalance(account, amount, key) {
  balQueue = balQueue.then(async () => {
    const snap = await getDoc(doc(db, 'budgets', state.budgetId));
    const cur = snap.exists() ? snap.data().settings?.balances || [] : state.budget.settings?.balances || [];
    let out = cur.map((b) => ({ ...b }));
    // fjern denne bankkonto fra andre budgetkonti (hvis den er flyttet)
    for (const b of out) {
      if (b.parts && key in b.parts && b.account !== account) {
        delete b.parts[key];
        b.amount = Math.round(Object.values(b.parts).reduce((x, y) => x + y, 0) * 100) / 100;
      }
    }
    out = out.filter((b) => !(b.source === 'bank' && b.parts && !Object.keys(b.parts).length));
    if (account && amount != null) {
      const old = out.find((b) => b.account === account);
      const parts = { ...(old?.source === 'bank' ? old.parts || {} : {}), [key]: amount };
      const total = Math.round(Object.values(parts).reduce((x, y) => x + y, 0) * 100) / 100;
      out = [...out.filter((b) => b.account !== account), { account, amount: total, date: isoDate(), source: 'bank', parts }];
    }
    if (JSON.stringify(out) === JSON.stringify(cur)) return;
    await saveBalances(out, { silent: true }); // banksaldo skifter hele tiden — fylder ikke loggen
  }).catch((e) => console.warn('saldo', e));
  return balQueue;
}
/** Fjern en bankkontos saldo fra budgettet (når den fjernes eller ikke længere hører til en budgetkonto). */
export const dropBalance = (key) => (canEdit() ? queueBalance('', null, key) : Promise.resolve());

/** Egne kategori-regler: "posteringer fra X er altid Y". Gemmes på budgettet. */
export const ruleKey = (k) => String(k).replace(/[^a-zæøåäöü]+/g, '_').slice(0, 60);
export function txRules() {
  const r = state.budget?.settings?.txRules || {};
  const out = {};
  for (const [k, v] of Object.entries(r)) out[k.replace(/_/g, ' ')] = v;
  return out;
}
export async function saveTxRule(partyKey, cat) {
  await updateDoc(doc(db, 'budgets', state.budgetId), { [`settings.txRules.${ruleKey(partyKey)}`]: cat });
}

/** Konti der trænger til at blive hentet (ældre end 6 timer), og som du selv har koblet på. */
export const needsSync = (acct) => acct.owners?.includes(state.user.uid) && (!acct.syncedAt || Date.now() - (acct.syncedAt?.toMillis?.() ?? acct.syncedAt) > 6 * 3600e3);

// ---------- Retur fra banken (MitID) ----------
export function stashCallback() {
  const p = new URLSearchParams(location.search);
  if (!p.get('state') || !(p.get('code') || p.get('error'))) return false;
  sessionStorage.setItem('bb:bankcb', JSON.stringify({ code: p.get('code'), state: p.get('state'), error: p.get('error'), desc: p.get('error_description') }));
  history.replaceState(null, '', `${location.pathname}#bank`);
  return true;
}
export function takeCallback() {
  const raw = sessionStorage.getItem('bb:bankcb');
  if (!raw) return null;
  sessionStorage.removeItem('bb:bankcb');
  try { return JSON.parse(raw); } catch { return null; }
}
export const rememberBudgetForBank = (id) => sessionStorage.setItem('bb:bankBudget', id);
export const bankBudget = () => sessionStorage.getItem('bb:bankBudget');
