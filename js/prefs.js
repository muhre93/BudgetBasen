// Personlige indstillinger: tema, dag/nat og simpel visning.
// Gemmes på enheden (så den åbner rigtigt med det samme) og på brugeren i Firestore,
// så indstillingen følger med til telefon og computer.
import { db, doc, setDoc, getDoc } from './firebase.js';
import { lsGet, lsSet } from './ui.js';
import { feature } from './config.js';

export const THEMES = [
  { id: 'morgen', name: 'Morgenlys', dark: false, sw: ['#f3f5fc', '#6c5cff', '#16c7b4', '#4f5ff0'] },
  { id: 'mint', name: 'Mint', dark: false, sw: ['#f1f8f6', '#34d3b4', '#8fd6ff', '#0d8f7f'] },
  { id: 'sand', name: 'Sand', dark: false, sw: ['#f8f4ec', '#f2c98a', '#9cc3e8', '#2f6fbf'] },
  { id: 'nordlys', name: 'Nordlys', dark: true, sw: ['#0b1020', '#6c5cff', '#16c7b4', '#7c8cff'] },
  { id: 'midnat', name: 'Midnat', dark: true, sw: ['#0f1726', '#1d3a66', '#2a2350', '#6ea8ff'] },
];
const DEFAULTS = { day: 'morgen', night: 'nordlys', mode: 'day', simple: false, hidden: [] };

let prefs = { ...DEFAULTS, ...lsGet('bb:prefs', {}) };
let uid = null;
const listeners = new Set();

export const getPrefs = () => ({ ...prefs });
export const onPrefs = (fn) => listeners.add(fn);
export const currentTheme = () => THEMES.find((t) => t.id === (prefs.mode === 'night' ? prefs.night : prefs.day)) || THEMES[0];
export const isSimple = () => !!prefs.simple && feature('simple');

export function applyTheme() {
  const t = currentTheme();
  document.documentElement.dataset.theme = t.id;
  document.querySelector('meta[name=theme-color]')?.setAttribute('content', t.sw[0]);
}

export async function setPrefs(patch) {
  prefs = { ...prefs, ...patch };
  lsSet('bb:prefs', prefs);
  applyTheme();
  listeners.forEach((fn) => fn(prefs));
  if (uid) await setDoc(doc(db, 'users', uid), { prefs }, { merge: true }).catch(() => {});
}

export const toggleDayNight = () => setPrefs({ mode: prefs.mode === 'night' ? 'day' : 'night' });

/** Efter login: hent indstillinger gemt på brugeren (hvis nogen). */
export async function loadUserPrefs(userId) {
  uid = userId;
  try {
    const s = await getDoc(doc(db, 'users', userId));
    const p = s.exists() ? s.data().prefs : null;
    if (p && typeof p === 'object') {
      prefs = { ...DEFAULTS, ...p };
      lsSet('bb:prefs', prefs);
      applyTheme();
      listeners.forEach((fn) => fn(prefs));
    }
  } catch { /* offline — brug enhedens indstillinger */ }
}

applyTheme();
