// Fælles app-tilstand + roller + standardlister.
import { DEFAULT_FREQUENCIES } from './calc.js';

export const state = {
  user: null,
  budgets: [],        // alle budgetter brugeren er medlem af
  budgetId: null,
  budget: null,       // det aktive budget-dokument
  items: [],          // budgetposter i aktivt budget
  itemsLoaded: false,
  col: {},            // lazy-loadede samlinger: receipts, documents
  invites: [],        // invitationer til den indloggede bruger
  view: 'budget',
  unsubs: {},
};

// ---------- Roller ----------
// members-map i budget-dokumentet: { uid: 'admin' | 'edit' | 'read' }. Ejeren står som 'admin' + ownerUid.
export const ROLES = { admin: 'Admin', edit: 'Redaktør', read: 'Kun læse' };
export const role = () => state.budget?.members?.[state.user?.uid] || '';
export const isOwner = () => !!state.budget && state.budget.ownerUid === state.user?.uid;
export const isAdmin = () => role() === 'admin';
export const canEdit = () => role() === 'admin' || role() === 'edit';
export const roleLabel = () => (isOwner() ? 'Ejer' : ROLES[role()] || '');

// ---------- Fleksible lister ----------
export const LIST_DEFS = [
  { key: 'categories', label: 'Kategorier / grupper', single: 'kategori' },
  { key: 'people', label: 'Personer (hvem betaler / tjener)', single: 'person' },
  { key: 'suppliers', label: 'Leverandører / afsendere / butikker', single: 'leverandør' },
  { key: 'methods', label: 'Betalingsmetoder', single: 'betalingsmetode' },
  { key: 'accounts', label: 'Konti', single: 'konto' },
  { key: 'docTypes', label: 'Dokumenttyper', single: 'dokumenttype' },
];

export function defaultLists(userName = '') {
  return {
    categories: ['Bolig', 'Forsikringer', 'Transport', 'Børn', 'Abonnementer', 'Mad & dagligvarer', 'Fritid', 'Opsparing', 'Lån', 'Løn', 'Offentlige ydelser', 'Andet'],
    people: [userName || 'Mig', 'Fælles'].filter(Boolean),
    suppliers: [],
    methods: ['Betalingsservice', 'Overførsel', 'Kort', 'MobilePay', 'Kontant'],
    accounts: ['Budgetkonto', 'Lønkonto', 'Opsparingskonto'],
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

// ---------- Simpel event-bus ----------
const listeners = new Set();
export const onChange = (fn) => listeners.add(fn);
let queued = false;
export function emit() {
  if (queued) return;
  queued = true;
  requestAnimationFrame(() => { queued = false; listeners.forEach((fn) => fn()); });
}
