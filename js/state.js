// Fælles app-tilstand + roller + standardlister + synlighed.
import { DEFAULT_FREQUENCIES } from './calc.js';

export const state = {
  user: null,
  budgets: [],        // alle budgetter brugeren er medlem af
  budgetId: null,
  budget: null,       // det aktive budget-dokument
  items: [],          // budgetposter i aktivt budget (kun dem brugeren må se)
  itemsLoaded: false,
  col: {},            // lazy-loadede samlinger: receipts, documents
  invites: [],        // invitationer til den indloggede bruger
  view: 'budget',
  unsubs: {},
};

// ---------- Roller ----------
// members-map i budget-dokumentet: { uid: 'admin' | 'edit' | 'read' }. Ejeren står som 'admin' + ownerUid.
export const ROLES = { admin: 'Admin', edit: 'Redaktør', read: 'Kun læse' };
export const ROLE_HELP = {
  admin: 'kan alt — også invitere og styre lister',
  edit: 'kan tilføje og rette poster, kvitteringer og dokumenter',
  read: 'kan kun se — godt til børn',
};
export const role = () => state.budget?.members?.[state.user?.uid] || '';
export const isOwner = () => !!state.budget && state.budget.ownerUid === state.user?.uid;
export const isAdmin = () => role() === 'admin';
export const canEdit = () => role() === 'admin' || role() === 'edit';
export const roleLabel = () => (isOwner() ? 'Ejer' : ROLES[role()] || '');

// ---------- Synlighed ----------
// Hver post/kvittering/dokument har visibleTo: ['all'] eller en liste af uid'er.
export const ALL = 'all';
export const members = () => Object.entries(state.budget?.memberInfo || {})
  .filter(([uid]) => state.budget?.members?.[uid])
  .map(([uid, m]) => ({ uid, name: m.name || m.email || 'Ukendt', email: m.email || '', photo: m.photo || '' }));
export const memberName = (uid) => state.budget?.memberInfo?.[uid]?.name?.split(' ')[0] || 'Ukendt';
export const isShared = (rec) => !Array.isArray(rec?.visibleTo) || rec.visibleTo.includes(ALL);
/** Standard-synlighed for nye ting i dette budget (kan sættes af admin) — altid inkl. en selv. */
export function defaultVisibleTo() {
  const d = state.budget?.settings?.defaultVisibleTo;
  if (!Array.isArray(d) || !d.length || d.includes(ALL)) return [ALL];
  return [...new Set([...d, state.user.uid])];
}
export function visibilityLabel(rec) {
  if (isShared(rec)) return 'Alle i budgettet';
  const v = rec.visibleTo;
  if (v.length === 1 && v[0] === state.user?.uid) return 'Kun dig';
  return v.map(memberName).join(', ');
}

// ---------- Fleksible lister ----------
export const LIST_DEFS = [
  { key: 'categories', label: 'Budget-kategorier', single: 'kategori', help: 'Grupperne på Budget-siden, fx Bolig og Forsikringer.' },
  { key: 'people', label: 'Personer', single: 'person', help: 'Hvem der betaler eller tjener pengene. "Fælles" betyder at I deler.' },
  { key: 'suppliers', label: 'Leverandører / afsendere', single: 'leverandør', help: 'Hvem der sender regningen eller pengene, fx Tryg eller Udbetaling Danmark.' },
  { key: 'methods', label: 'Betalingsmetoder', single: 'betalingsmetode', help: 'Hvordan der betales, fx Betalingsservice.' },
  { key: 'accounts', label: 'Konti', single: 'konto', help: 'Jeres bankkonti. Markér hvilke der er fælles.' },
  { key: 'stores', label: 'Butikker (kvitteringer)', single: 'butik', help: 'Kun til kvitteringer, fx Netto, Elgiganten.' },
  { key: 'receiptCategories', label: 'Kvitterings-kategorier', single: 'kvitteringskategori', help: 'Kun til kvitteringer, fx Tøj, Gaver, Elektronik.' },
  { key: 'docTypes', label: 'Dokumenttyper', single: 'dokumenttype', help: 'Typer af kontrakter og policer.' },
];

export function defaultLists(userName = '') {
  return {
    categories: ['Bolig', 'Forsikringer', 'Transport', 'Børn', 'Abonnementer', 'Mad & dagligvarer', 'Fritid', 'Opsparing', 'Lån', 'Løn', 'Offentlige ydelser', 'Andet'],
    people: [userName || 'Mig', 'Fælles'].filter(Boolean),
    suppliers: [],
    methods: ['Betalingsservice', 'Overførsel', 'Kort', 'MobilePay', 'Kontant'],
    accounts: ['Budgetkonto', 'Fælleskonto', 'Lønkonto', 'Opsparingskonto'],
    stores: ['Netto', 'Rema 1000', 'Føtex', 'Bilka', 'Elgiganten', 'IKEA'],
    receiptCategories: ['Dagligvarer', 'Tøj & sko', 'Elektronik', 'Gaver', 'Hus & have', 'Bil', 'Sundhed', 'Børn', 'Fritid', 'Andet'],
    docTypes: ['Forsikring', 'Lejekontrakt', 'Abonnement', 'Lån', 'Garanti', 'Andet'],
    frequencies: DEFAULT_FREQUENCIES,
  };
}

export function lists() {
  const d = defaultLists();
  const l = state.budget?.lists || {};
  const out = {};
  for (const k of Object.keys(d)) out[k] = Array.isArray(l[k]) ? l[k] : d[k];
  out.frequencies = [...out.frequencies].sort((a, b) => a.months - b.months);
  return out;
}

/** Konti der tæller som fælles (poster herfra fordeles ikke på personer). */
export function jointAccounts() {
  const j = state.budget?.settings?.jointAccounts;
  return Array.isArray(j) ? j : ['Budgetkonto', 'Fælleskonto'];
}

// ---------- Simpel event-bus ----------
const listeners = new Set();
export const onChange = (fn) => listeners.add(fn);
let queued = false;
export function emit() {
  if (queued) return;
  queued = true;
  requestAnimationFrame(() => { queued = false; listeners.forEach((fn) => fn()); });
}
