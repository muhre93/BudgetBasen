// Ejer-admin: kun for app-ejeren (muhre93@gmail.com). Styrer ting for ALLE brugere:
// funktioner til/fra, tekster, budgetsidens opbygning, en besked til alle og en brugeroversigt.
// Sikkerheden ligger i Firestore-reglerne (config/app kan kun skrives af ejeren).
import { state } from '../state.js';
import { esc, fmtDate, toast, errorToast, confirmDialog, toDate } from '../ui.js';
import { db, collection, getDocs } from '../firebase.js';
import { getConfig, saveConfig, FEATURES, SECTIONS, isAppOwner } from '../config.js';
import { HELP } from '../help.js';
import { bankApi } from '../bank.js';

const TABS = [
  { id: 'features', label: 'Funktioner' },
  { id: 'texts', label: 'Tekster' },
  { id: 'layout', label: 'Budget-siden' },
  { id: 'announce', label: 'Besked til alle' },
  { id: 'users', label: 'Brugere' },
];
const ui = { tab: 'features', users: null, bank: null, usersErr: null };
const LOGIN_DEF = {
  tagline: 'Budget, likviditet, kvitteringer og kontrakter — samlet ét sted for hele familien.',
  points: ['Se måned for måned om budgetkontoen holder', 'Scan kvitteringer direkte med telefonen', 'Del budgettet med din partner — eller banken'],
  foot: 'Nye brugere får automatisk deres eget private budget. Ingen andre kan se det, før du selv inviterer dem.',
};

export function render(root) {
  if (!isAppOwner(state.user)) { root.innerHTML = '<div class="empty glass"><p>Kun app-ejeren har adgang her.</p></div>'; return; }
  root.innerHTML = `<div class="view-wrap owner-view">
    <section class="glass card owner-head"><h2>👑 Ejer-admin</h2>
      <p class="muted small">Det du ændrer her, gælder for <b>alle brugere</b> af BudgetBasen med det samme — der skal ikke uploades nye filer. Hvert budget har stadig sin egen almindelige Admin.</p></section>
    <nav class="subtabs glass">${TABS.map((t) => `<button data-otab="${t.id}" class="${t.id === ui.tab ? 'active' : ''}">${t.label}</button>`).join('')}</nav>
    <div id="owner-body"></div></div>`;
  root.querySelectorAll('[data-otab]').forEach((b) => (b.onclick = () => { ui.tab = b.dataset.otab; render(root); }));
  const body = root.querySelector('#owner-body');
  ({ features, texts, layout, announce, users })[ui.tab](body, root);
}

async function save(patch, msg = 'Gemt — gælder nu for alle') {
  try { await saveConfig(patch); toast(msg); } catch (e) { errorToast(e); }
}

// ---------- Funktioner ----------
function features(el) {
  const c = getConfig();
  el.innerHTML = `<section class="glass card">
    <h2>Funktioner til og fra</h2>
    <p class="muted small">Slår du en funktion fra, forsvinder den for alle. Data bliver liggende og kommer igen, hvis du slår den til.</p>
    <div class="checks">${FEATURES.map((f) => `<label class="check big-check"><input type="checkbox" name="${f.id}" ${c.features[f.id] !== false ? 'checked' : ''}>
      <span><b>${esc(f.label)}</b><br><span class="muted small">${esc(f.help)}</span></span></label>`).join('')}</div>
    <div class="btn-row"><button class="btn primary" id="of-save">Gem funktioner</button></div>
  </section>`;
  el.querySelector('#of-save').onclick = () => {
    const out = {};
    for (const f of FEATURES) out[f.id] = el.querySelector(`[name=${f.id}]`).checked;
    save({ features: out });
  };
}

// ---------- Tekster ----------
function texts(el) {
  const c = getConfig();
  const L = c.texts.login || {};
  const H = c.texts.help || {};
  el.innerHTML = `
    <section class="glass card">
      <h2>Login-siden</h2>
      <p class="muted small">Tomme felter bruger standardteksten (vist som grå tekst).</p>
      <label>Undertitel<textarea name="tagline" rows="2" placeholder="${esc(LOGIN_DEF.tagline)}">${esc(L.tagline || '')}</textarea></label>
      ${LOGIN_DEF.points.map((p, i) => `<label>Punkt ${i + 1}<input name="point${i}" placeholder="${esc(p)}" value="${esc(L.points?.[i] || '')}"></label>`).join('')}
      <label>Lille tekst nederst<textarea name="foot" rows="2" placeholder="${esc(LOGIN_DEF.foot)}">${esc(L.foot || '')}</textarea></label>
    </section>
    <section class="glass card">
      <h2>Velkomstguiden</h2>
      <label>Første tekst, nye brugere ser<textarea name="welcome" rows="3" placeholder="Her samler I alt om familiens økonomi …">${esc(c.texts.welcome || '')}</textarea></label>
    </section>
    <section class="glass card">
      <h2>Hjælpetekster (de små ?-knapper)</h2>
      <p class="muted small">Ret overskrift og tekst. Tryk "Standard" for at gå tilbage til den oprindelige tekst.</p>
      ${Object.entries(HELP).map(([k, [t, txt]]) => `<details class="help-edit" ${H[k] ? 'open' : ''}>
        <summary><b>${esc(H[k]?.[0] || t)}</b>${H[k] ? ' <span class="chip ok">rettet</span>' : ''}</summary>
        <label>Overskrift<input data-ht="${k}" placeholder="${esc(t)}" value="${esc(H[k]?.[0] || '')}"></label>
        <label>Tekst<textarea data-hx="${k}" rows="4" placeholder="${esc(txt)}">${esc(H[k]?.[1] || '')}</textarea></label>
        <button type="button" class="btn small ghost" data-hreset="${k}">Standard</button>
      </details>`).join('')}
    </section>
    <div class="btn-row sticky-save"><button class="btn primary" id="ot-save">Gem alle tekster</button></div>`;
  el.querySelectorAll('[data-hreset]').forEach((b) => (b.onclick = () => {
    el.querySelector(`[data-ht="${b.dataset.hreset}"]`).value = '';
    el.querySelector(`[data-hx="${b.dataset.hreset}"]`).value = '';
  }));
  el.querySelector('#ot-save').onclick = () => {
    const v = (n) => el.querySelector(`[name=${n}]`).value.trim();
    const help = {};
    for (const k of Object.keys(HELP)) {
      const t = el.querySelector(`[data-ht="${k}"]`).value.trim();
      const x = el.querySelector(`[data-hx="${k}"]`).value.trim();
      if (t || x) help[k] = [t || HELP[k][0], x || HELP[k][1]];
    }
    save({ texts: { login: { tagline: v('tagline'), points: [0, 1, 2].map((i) => v(`point${i}`)), foot: v('foot') }, welcome: v('welcome'), help } });
  };
}

// ---------- Budget-siden ----------
function layout(el, root) {
  const c = getConfig();
  const order = [...c.layout.order];
  const hidden = new Set(c.layout.hidden);
  const draw = () => {
    el.innerHTML = `<section class="glass card">
      <h2>Budget-sidens opbygning</h2>
      <p class="muted small">Flyt kasserne op og ned, og vælg hvilke der vises. Gælder den udvidede visning for alle.</p>
      <ol class="layout-list">${order.map((id, i) => {
        const s = SECTIONS.find((x) => x.id === id);
        return `<li class="${hidden.has(id) ? 'off' : ''}">
          <span class="ll-name">${esc(s.label)}</span>
          <span class="btn-row">
            <button type="button" class="btn small ghost" data-up="${i}" ${i === 0 ? 'disabled' : ''} aria-label="Flyt op">↑</button>
            <button type="button" class="btn small ghost" data-down="${i}" ${i === order.length - 1 ? 'disabled' : ''} aria-label="Flyt ned">↓</button>
            ${id === 'list' ? '<span class="chip">altid vist</span>' : `<label class="check"><input type="checkbox" data-show="${id}" ${hidden.has(id) ? '' : 'checked'}> Vis</label>`}
          </span></li>`;
      }).join('')}</ol>
      <div class="btn-row"><button class="btn primary" id="ol-save">Gem opbygning</button><button class="btn ghost" id="ol-reset">Standard</button></div>
    </section>`;
    el.querySelectorAll('[data-up]').forEach((b) => (b.onclick = () => { const i = +b.dataset.up; [order[i - 1], order[i]] = [order[i], order[i - 1]]; draw(); }));
    el.querySelectorAll('[data-down]').forEach((b) => (b.onclick = () => { const i = +b.dataset.down; [order[i + 1], order[i]] = [order[i], order[i + 1]]; draw(); }));
    el.querySelectorAll('[data-show]').forEach((b) => (b.onchange = () => { if (b.checked) hidden.delete(b.dataset.show); else hidden.add(b.dataset.show); draw(); }));
    el.querySelector('#ol-save').onclick = () => save({ layout: { order, hidden: [...hidden] } });
    el.querySelector('#ol-reset').onclick = () => { order.splice(0, order.length, ...SECTIONS.map((s) => s.id)); hidden.clear(); draw(); };
  };
  draw();
}

// ---------- Besked ----------
function announce(el) {
  const a = getConfig().announcement || {};
  el.innerHTML = `<section class="glass card">
    <h2>Besked til alle brugere</h2>
    <p class="muted small">Vises øverst for alle, indtil de lukker den. Ændrer du teksten, ser alle den igen.</p>
    <label>Besked<textarea name="text" rows="3" maxlength="300" placeholder="fx Ny version: nu kan du koble din bank på 🏦">${esc(a.text || '')}</textarea></label>
    <div class="pair"><label>Type<select name="level"><option value="info" ${a.level !== 'warn' ? 'selected' : ''}>📣 Information</option><option value="warn" ${a.level === 'warn' ? 'selected' : ''}>⚠️ Vigtigt</option></select></label>
    <label class="check big-check"><input type="checkbox" name="active" ${a.active ? 'checked' : ''}> Vis beskeden</label></div>
    <div class="btn-row"><button class="btn primary" id="oa-save">Gem besked</button></div>
  </section>`;
  el.querySelector('#oa-save').onclick = () => {
    const text = el.querySelector('[name=text]').value.trim();
    const level = el.querySelector('[name=level]').value;
    const active = el.querySelector('[name=active]').checked && !!text;
    const id = text === a.text && level === a.level ? a.id || String(Date.now()) : String(Date.now());
    save({ announcement: { id, text, level, active } }, active ? 'Beskeden vises nu for alle' : 'Beskeden er skjult');
  };
}

// ---------- Brugere ----------
function users(el, root) {
  if (!ui.users && !ui.usersErr) {
    el.innerHTML = '<section class="glass card"><p class="muted">Henter brugere …</p></section>';
    Promise.all([
      getDocs(collection(db, 'users')).then((s) => s.docs.map((d) => ({ uid: d.id, ...d.data() }))),
      bankApi('/admin').then((r) => r.users || []).catch(() => null),
    ]).then(([u, b]) => { ui.users = u; ui.bank = b; render(root); }).catch((e) => { ui.usersErr = e.message; render(root); });
    return;
  }
  if (ui.usersErr) { el.innerHTML = `<section class="glass card"><p class="hint warn">Kunne ikke hente brugere: ${esc(ui.usersErr)}. Er de nye Firestore-regler uploadet?</p></section>`; ui.usersErr = null; return; }
  const bank = new Map((ui.bank || []).map((x) => [x.uid, x]));
  const list = [...ui.users].sort((a, b) => (toDate(b.lastLogin)?.getTime() || 0) - (toDate(a.lastLogin)?.getTime() || 0));
  el.innerHTML = `<section class="glass card">
    <div class="section-head"><h2>Brugere (${list.length})</h2><button class="btn small ghost" id="ou-reload">↻ Opdater</button></div>
    ${ui.bank === null ? '<p class="muted small">Bankstatus kunne ikke hentes (er BANK_SECRET sat på Worker’en?).</p>' : ''}
    <ul class="rows owner-users">${list.map((u) => {
      const b = bank.get(u.uid);
      const exp = b?.sess?.exp ? Math.ceil((new Date(b.sess.exp) - Date.now()) / 864e5) : null;
      return `<li><div><b>${esc(u.displayName || 'Uden navn')}</b><div class="muted small">${esc(u.email || '')}</div>
        <div class="muted small">Sidst logget ind: ${u.lastLogin ? fmtDate(toDate(u.lastLogin)) : 'ukendt'}</div></div>
        <div class="owner-bank small">${b?.cfg ? `🔑 Bank-nøgle sat (${esc(b.cfg.app || 'app')})` : '<span class="muted">Ingen bank</span>'}
          ${b?.sess ? `<br>🏦 ${esc((b.sess.banks || []).join(', '))} · ${b.sess.accounts} konti${exp !== null ? ` · <span class="${exp <= 14 ? 'warn' : ''}">udløber om ${exp} dage</span>` : ''}` : ''}</div></li>`;
    }).join('')}</ul>
    <p class="muted small">Du kan kun se navn, e-mail og bankstatus — aldrig andres budgetter, saldi eller posteringer.</p>
  </section>`;
  el.querySelector('#ou-reload').onclick = () => { ui.users = null; ui.bank = null; render(root); };
}
