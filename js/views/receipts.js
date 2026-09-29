// Kvitteringer: scan med kameraet, gem billeder/PDF fra telefonen, søg på dato/kategori/beløb/butik/person.
// Egne lister (Butikker, Kvitterings-kategorier) — adskilt fra budgettets.
import { state, canEdit, lists, isShared, visibilityLabel, defaultVisibleTo } from '../state.js';
import { esc, kr, fmtDate, openModal, confirmDialog, toast, parseAmount, numToInput, isoDate, firstName } from '../ui.js';
import { watch, saveRecord, deleteRecord } from '../data.js';
import { uploadFile, makeThumb, openFile, removeFile } from '../files.js';
import { listSelect, bindListSelects, visibilityPicker, bindVisibility, readVisibility } from '../forms.js';
import { exportButtons, bindExportButtons, receiptsToPdf, receiptsToExcel } from '../export.js';

const EMPTY = { q: '', from: '', to: '', cat: '', who: '', store: '', min: '', max: '', sort: 'date-desc' };
const ui = { ...EMPTY, open: false };

export function render(root) {
  watch('receipts');
  const L = lists();
  const key = `receipts:${state.budgetId}:${canEdit()}:${JSON.stringify([L.stores, L.receiptCategories, L.people])}`;
  if (root.dataset.shell !== key) buildShell(root, L, key);
  update(root);
}

function buildShell(root, L, key) {
  root.dataset.shell = key;
  const opt = (arr, all) => `<option value="">${all}</option>${arr.map((x) => `<option>${esc(x)}</option>`).join('')}`;
  root.innerHTML = `<div class="view-wrap">
    ${canEdit() ? `<section class="scan-bar glass">
      <label class="btn primary big scan-btn">
        <svg viewBox="0 0 24 24"><path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2"/><circle cx="12" cy="12" r="3.5"/></svg>
        Tag billede af kvittering
        <input type="file" accept="image/*" capture="environment" id="rc-cam" hidden>
      </label>
      <label class="btn ghost">📁 Vælg billede eller PDF<input type="file" accept="image/*,application/pdf" id="rc-file" hidden></label>
      <button class="btn ghost" id="rc-manual" type="button">✍️ Uden billede</button>
    </section>` : ''}

    <section class="toolbar glass">
      <div class="toolbar-row">
        <input id="rc-q" type="search" placeholder="Søg butik, hvad der er købt, note…" value="${esc(ui.q)}" enterkeyhint="search" autocomplete="off">
        <button class="btn ghost filter-btn" id="rc-fbtn" type="button"><svg viewBox="0 0 24 24"><path d="M3 5h18l-7 8v6l-4 2v-8z"/></svg>Filter<span class="badge-count hidden" id="rc-fcount"></span></button>
      </div>
      <div class="filter-panel ${ui.open ? '' : 'hidden'}" id="rc-fpanel">
        <label>Butik<select data-f="store">${opt(L.stores, 'Alle butikker')}</select></label>
        <label>Kategori<select data-f="cat">${opt(L.receiptCategories, 'Alle kategorier')}</select></label>
        <label>Hvem<select data-f="who">${opt(L.people, 'Alle personer')}</select></label>
        <label>Sortér<select data-f="sort"><option value="date-desc">Nyeste først</option><option value="date-asc">Ældste først</option><option value="amount-desc">Dyreste først</option><option value="store">Butik A–Å</option></select></label>
        <label>Fra dato<input type="date" data-f="from"></label>
        <label>Til dato<input type="date" data-f="to"></label>
        <label>Beløb fra<input data-f="min" inputmode="decimal" placeholder="0 kr."></label>
        <label>Beløb til<input data-f="max" inputmode="decimal" placeholder="ingen grænse"></label>
        <div class="filter-foot"><button type="button" class="btn small ghost" id="rc-reset">Nulstil filtre</button></div>
      </div>
    </section>
    <div id="rc-results"></div></div>`;
  const w = root.firstElementChild;

  w.querySelectorAll('[data-f]').forEach((el) => {
    el.value = ui[el.dataset.f];
    el.addEventListener(el.tagName === 'SELECT' || el.type === 'date' ? 'change' : 'input', () => { ui[el.dataset.f] = el.value; update(root); });
  });
  const q = w.querySelector('#rc-q');
  q.addEventListener('input', () => { ui.q = q.value; update(root); });
  q.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); q.blur(); } });
  w.querySelector('#rc-fbtn').onclick = () => { ui.open = !ui.open; w.querySelector('#rc-fpanel').classList.toggle('hidden', !ui.open); };
  w.querySelector('#rc-reset').onclick = () => {
    Object.assign(ui, { ...EMPTY, q: ui.q, open: ui.open });
    w.querySelectorAll('[data-f]').forEach((el) => (el.value = ui[el.dataset.f]));
    update(root);
  };
  const onFile = (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) openReceiptModal(null, f); };
  w.querySelector('#rc-cam')?.addEventListener('change', onFile);
  w.querySelector('#rc-file')?.addEventListener('change', onFile);
  w.querySelector('#rc-manual')?.addEventListener('click', () => openReceiptModal(null, null));
  w.addEventListener('click', (e) => {
    const c = e.target.closest('[data-rc]');
    if (c) openReceiptModal((state.col.receipts || []).find((r) => r.id === c.dataset.rc));
  });
}

const activeCount = () => ['from', 'to', 'cat', 'who', 'store', 'min', 'max'].filter((k) => ui[k]).length;

function update(root) {
  const all = state.col.receipts;
  const out = root.querySelector('#rc-results');
  const n = activeCount();
  const badge = root.querySelector('#rc-fcount');
  badge.textContent = n; badge.classList.toggle('hidden', !n);
  root.querySelector('#rc-fbtn').classList.toggle('on', n > 0);
  if (!all) { out.innerHTML = '<div class="skeleton"></div>'; return; }
  const list = filterSort(all);
  const total = list.reduce((s, r) => s + (Number(r.amount) || 0), 0);
  out.innerHTML = `
    <div class="result-bar">
      <p class="result-line"><b>${list.length}</b> kvitteringer${list.length !== all.length ? ` (af ${all.length})` : ''} · i alt <b>${kr(total)}</b></p>
      ${list.length ? exportButtons('rc-exp') : ''}
    </div>
    ${list.length ? `<div class="receipt-grid">${list.map(card).join('')}</div>`
      : `<div class="empty glass"><div class="empty-emoji">📸</div><h3>${all.length ? 'Ingen kvitteringer passer til søgningen' : 'Ingen kvitteringer endnu'}</h3><p>${all.length ? 'Prøv at ændre søgning eller filter.' : 'Tryk på "Tag billede af kvittering" på telefonen — eller vælg en PDF fra fx en mail.'}</p></div>`}`;
  const label = state.budget.name;
  const filterText = [ui.q && `"${ui.q}"`, ui.store, ui.cat, ui.who, ui.from && `fra ${fmtDate(ui.from)}`, ui.to && `til ${fmtDate(ui.to)}`, ui.min && `min ${ui.min} kr.`, ui.max && `max ${ui.max} kr.`].filter(Boolean).join(', ');
  bindExportButtons(out, 'rc-exp', {
    what: `Kvitteringerne der vises lige nu (${list.length} stk., i alt ${kr(total)}).`,
    pdf: () => receiptsToPdf(list, label, filterText), xlsx: () => receiptsToExcel(list, label),
  });
}

function filterSort(all) {
  const q = ui.q.trim().toLowerCase();
  const min = parseAmount(ui.min), max = parseAmount(ui.max);
  const out = all.filter((r) => {
    if (q && ![r.store, r.what, r.note, r.category, r.who].some((f) => String(f || '').toLowerCase().includes(q))) return false;
    if (ui.store && r.store !== ui.store) return false;
    if (ui.cat && r.category !== ui.cat) return false;
    if (ui.who && r.who !== ui.who) return false;
    if (ui.from && (r.date || '') < ui.from) return false;
    if (ui.to && (r.date || '') > ui.to) return false;
    if (!Number.isNaN(min) && (Number(r.amount) || 0) < min) return false;
    if (!Number.isNaN(max) && (Number(r.amount) || 0) > max) return false;
    return true;
  });
  const cmp = {
    'date-desc': (a, b) => (b.date || '').localeCompare(a.date || ''),
    'date-asc': (a, b) => (a.date || '').localeCompare(b.date || ''),
    'amount-desc': (a, b) => (Number(b.amount) || 0) - (Number(a.amount) || 0),
    store: (a, b) => String(a.store || '').localeCompare(String(b.store || ''), 'da'),
  }[ui.sort] || (() => 0);
  return out.sort(cmp);
}

function card(r) {
  const isPdf = r.file?.contentType === 'application/pdf';
  return `<button class="receipt-card glass" data-rc="${r.id}">
    <div class="rc-thumb">${r.thumb ? `<img src="${r.thumb}" alt="" loading="lazy">` : `<span class="rc-ph">${isPdf ? 'PDF' : '🧾'}</span>`}</div>
    <div class="rc-body">
      <div class="rc-top"><b>${esc(r.store || r.what || 'Kvittering')}</b><span class="rc-amt">${kr(r.amount)}</span></div>
      <div class="rc-what">${esc(r.store ? r.what || '' : '')}${!isShared(r) ? ` <span class="vis-tag">🔒 ${esc(visibilityLabel(r))}</span>` : ''}</div>
      <div class="rc-meta">${esc(fmtDate(r.date))}${r.category ? ` · ${esc(r.category)}` : ''}${r.who ? ` · ${esc(r.who)}` : ''}</div>
    </div>
  </button>`;
}

export function openReceiptModal(rec = null, file = null) {
  const editing = !!rec;
  const readOnly = !canEdit();
  const people = lists().people;
  const meName = firstName(state.user.displayName);
  const r = rec || { date: isoDate(), who: people.includes(meName) ? meName : '', visibleTo: defaultVisibleTo() };
  const previewUrl = file && file.type.startsWith('image/') ? URL.createObjectURL(file) : null;

  const preview = previewUrl ? `<img src="${previewUrl}" alt="Kvittering">`
    : r.thumb ? `<img src="${r.thumb}" alt="Kvittering">`
    : file ? `<div class="rc-ph big">PDF · ${esc(file.name)}</div>`
    : r.file ? '<div class="rc-ph big">PDF</div>' : '';

  const body = `
    ${preview ? `<div class="rc-preview">${preview}${r.file ? '<button type="button" class="btn small ghost" data-open>Åbn original / gem på telefonen</button>' : ''}</div>` : ''}
    <div class="grid2">
      <label>Hvornår<input type="date" name="date" required value="${esc(r.date || '')}"></label>
      <label>Beløb (kr.)<input name="amount" inputmode="decimal" required value="${numToInput(r.amount)}" placeholder="0,00"></label>
    </div>
    <div class="grid2">
      <label>Butik${listSelect('store', 'stores', r.store, { placeholder: '— Vælg butik —' })}</label>
      <label>Kategori${listSelect('category', 'receiptCategories', r.category)}</label>
    </div>
    <label>Hvad er købt?<input name="what" maxlength="200" value="${esc(r.what)}" placeholder="fx Vinterjakke, fødselsdagsgave"></label>
    <label>Hvem købte det${listSelect('who', 'people', r.who)}</label>
    <label>Note (garanti, returret …)<textarea name="note" rows="2" maxlength="1000">${esc(r.note)}</textarea></label>
    <label>Garanti/returret slutter (valgfri)<input type="date" name="warrantyUntil" value="${esc(r.warrantyUntil || '')}"></label>
    ${visibilityPicker(r)}
    ${editing && !file && !readOnly ? '<label class="file-replace">Skift billede/PDF<input type="file" name="newfile" accept="image/*,application/pdf"></label>' : ''}
    ${editing ? `<p class="muted small">Tilføjet af ${esc(r.createdByName || '')} ${fmtDate(r.createdAt, true)}</p>` : ''}`;

  const buttons = editing && !readOnly ? [{ label: 'Slet', cls: 'danger-ghost', onClick: async () => {
    if (!(await confirmDialog('Slet kvitteringen og billedet?'))) return false;
    await deleteRecord('receipts', rec); toast('Kvittering slettet');
  } }] : [];

  openModal({
    title: editing ? 'Kvittering' : 'Ny kvittering', body, readOnly, buttons,
    submitLabel: editing ? 'Gem' : 'Gem kvittering',
    onClose: () => previewUrl && URL.revokeObjectURL(previewUrl),
    onOpen: (form) => {
      bindListSelects(form);
      bindVisibility(form);
      form.querySelector('[data-open]')?.addEventListener('click', () => openFile(r.file).catch((e) => toast(e.message, 'error')));
    },
    onSubmit: async (fd, form) => {
      const amount = parseAmount(fd.get('amount'));
      if (Number.isNaN(amount)) { toast('Skriv et gyldigt beløb', 'error'); return false; }
      const data = {
        date: fd.get('date'), amount: Math.round(amount * 100) / 100, store: fd.get('store') || '',
        what: String(fd.get('what') || '').trim(), category: fd.get('category') || '', who: fd.get('who') || '',
        note: String(fd.get('note') || '').trim(), warrantyUntil: fd.get('warrantyUntil') || null,
        visibleTo: readVisibility(form),
      };
      const newFile = file || (fd.get('newfile')?.size ? fd.get('newfile') : null);
      if (newFile) {
        toast('Gemmer billedet …', 'ok', 1500);
        data.file = await uploadFile(newFile, 'receipts');
        data.thumb = await makeThumb(newFile).catch(() => null);
        if (rec?.file) await removeFile(rec.file).catch(() => {});
      }
      await saveRecord('receipts', rec?.id || null, data, rec);
      toast(editing ? 'Kvittering opdateret' : 'Kvittering gemt');
    },
  });
}
