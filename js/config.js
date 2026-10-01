// App-indstillinger, som kun app-ejeren kan ændre (Ejer-admin): funktioner til/fra,
// tekster, rækkefølgen på budgetsiden og en besked til alle brugere.
// Ligger i Firestore: config/app (alle kan læse — så login-siden også kan vise teksterne).
import { db, doc, onSnapshot, setDoc, serverTimestamp } from './firebase.js';

export const OWNER_EMAIL = 'muhre93@gmail.com';

export const FEATURES = [
  { id: 'receipts', label: 'Kvitteringer', help: 'Fanen Kvitteringer (scan og gem kvitteringer).' },
  { id: 'documents', label: 'Dokumenter', help: 'Fanen Dokumenter (kontrakter, forsikringer, garantier).' },
  { id: 'bank', label: 'Bankforbindelse', help: 'Bank-fanen, hvor man kan koble sin bank på via Enable Banking. Skal også slås til i det enkelte budget.' },
  { id: 'compare', label: 'Sammenlign versioner', help: 'Knappen "Sammenlign" og gemte versioner af budgettet.' },
  { id: 'export', label: 'Hent / del (PDF og Excel)', help: 'Knapperne til at hente og dele som PDF eller Excel.' },
  { id: 'demo', label: 'Prøvebudget', help: 'Tilbuddet om at se et prøvebudget med en opdigtet familie.' },
  { id: 'simple', label: 'Simpel visning', help: 'Muligheden for at skifte til simpel visning.' },
];

export const SECTIONS = [
  { id: 'view', label: 'Vælg konto (Hele budgettet / én konto)', el: '#b-view' },
  { id: 'kpis', label: 'De store tal (indtægter, udgifter, tilbage)', el: '#b-kpis' },
  { id: 'funding', label: 'Status for overførsler til konti', el: '#b-funding' },
  { id: 'persons', label: 'Hvem betaler hvad', el: '#b-persons' },
  { id: 'balances', label: 'Hvad står der på kontoen?', el: '#b-balances' },
  { id: 'list', label: 'Søg, knapper og alle poster', el: null },
];

const DEFAULT = {
  features: Object.fromEntries(FEATURES.map((f) => [f.id, true])),
  texts: { help: {}, login: {}, welcome: '' },
  layout: { order: SECTIONS.map((s) => s.id), hidden: [] },
  announcement: { id: '', text: '', level: 'info', active: false },
};

let cfg = structuredClone(DEFAULT);
const listeners = new Set();
let started = false;

export const getConfig = () => cfg;
export const onConfig = (fn) => listeners.add(fn);
export const feature = (id) => cfg.features?.[id] !== false;

/** Starter lytteren. Kaldes én gang ved opstart (også før login). */
export function startConfig() {
  if (started) return;
  started = true;
  onSnapshot(doc(db, 'config', 'app'), (s) => {
    const d = s.exists() ? s.data() : {};
    cfg = {
      features: { ...DEFAULT.features, ...(d.features || {}) },
      texts: { help: { ...(d.texts?.help || {}) }, login: { ...(d.texts?.login || {}) }, welcome: d.texts?.welcome || '' },
      layout: normalizeLayout(d.layout),
      announcement: { ...DEFAULT.announcement, ...(d.announcement || {}) },
    };
    listeners.forEach((fn) => fn(cfg));
  }, (e) => console.warn('config', e));
}

function normalizeLayout(l) {
  const ids = SECTIONS.map((s) => s.id);
  const order = Array.isArray(l?.order) ? l.order.filter((x) => ids.includes(x)) : [];
  for (const id of ids) if (!order.includes(id)) order.push(id);
  const hidden = Array.isArray(l?.hidden) ? l.hidden.filter((x) => ids.includes(x) && x !== 'list') : [];
  return { order, hidden };
}

export function isAppOwner(user) {
  return !!user && user.emailVerified !== false && String(user.email || '').toLowerCase() === OWNER_EMAIL;
}

export async function saveConfig(patch) {
  // mergeFields: de felter, der gemmes, erstattes helt (så nulstillede tekster forsvinder)
  await setDoc(doc(db, 'config', 'app'), { ...patch, updatedAt: serverTimestamp() }, { mergeFields: [...Object.keys(patch), 'updatedAt'] });
}
