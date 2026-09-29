// Kvitteringer: scan med kameraet, tilføj metadata, søg på tværs af dato/kategori/beløb/butik/person.
import { state, canEdit } from '../state.js';
import { esc, kr, fmtDate, openModal, confirmDialog, toast, parseAmount, numToInput, isoDate, firstName } from '../ui.js';
import { lists } from '../state.js';
import { watch, saveRecord, deleteRecord } from '../data.js';
import { uploadFile, makeThumb, openFile, removeFile } from '../files.js';
import { listSelect, filterSelect, bindListSelects } from '../forms.js';
import { exportButtons, bindExportButtons, receiptsToPdf, receiptsToExcel } from '../export.js';

const ui = { q: '', from: '', to: '', cat: '', who: '', min: '', max: '', sort: 'date-desc' };

export function render(root) {
  watch('receipts');
  const all = state.col.receipts;
  const list = all ? filterSort(all) : [];
  const total = list.reduce((s, r) => s + (Number(r.amount) || 0), 0);
  const edit = canEdit();

  root.innerHTML = `
    ${edit ? `<section class="scan-bar glass">
      <label class="btn primary big scan-btn">
        <svg viewBox="0 0 24 24"><path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2"/><circle cx="12" cy="12" r="3.5"/></svg>
        Scan kvittering
        <input type="file" accept="image/*" capture="environment" id="rc-cam" hidden>
      </label>
      <label class="btn ghost">Upload billede / PDF<input type="file" accept="image/*,application/pdf" id="rc-file" hidden></label>
      <button class="btn ghost" id="rc-manual">Uden billede</button>
    </section>` : ''}

    <section class="toolbar glass">
      <div class="toolbar-row">
        <input id="rc-q" type="search" placeholder="Søg butik, hvad, note…" value="${esc(ui.q)}">
        ${filterSelect('rc-cat', 'categories', ui.cat, 'Alle kategorier')}
        ${filterSelect('rc-who', 'people', ui.who, 'Alle personer')}
      </div>
      <div class="toolbar-row">
        <label class="inline">Fra<input type="date" id="rc-from" value="${esc(ui.from)}"></label>
        <label class="inline">Til<input type="date" id="rc-to" value="${esc(ui.to)}"></label>
        <label class="inline">Beløb<input id="rc-min" inputmode="decimal" placeholder="min" value="${esc(ui.min)}" class="w-sm">–<input id="rc-max" inputmode="decimal" placeholder="max" value="${esc(ui.max)}" class="w-sm"></label>
        <select id="rc-sort">
          <option value="date-desc" ${ui.sort === 'date-desc' ? 'selected' : ''}>Nyeste først</option>
          <option value="date-asc" ${ui.sort === 'date-asc' ? 'selected' : ''}>Ældste først</option>
          <option value="amount-desc" ${ui.sort === 'amount-desc' ? 'selected' : ''}>Højeste beløb</option>
          <option value="store" ${ui.sort === 'store' ? 'selected' : ''}>Butik A–Å</option>
        </select>
        <button class="btn small ghost" id="rc-reset">Nulstil</button>
        <span class="spacer"></span>
        ${all && list.length ? exportButtons('rc-exp') : ''}
      </div>
    </section>

    ${!all ? '<div class="skeleton"></div>' : `
      <p class="result-line"><b>${list.length}</b> kvitteringer${list.length !== all.length ? ` (af ${all.length})` : ''} · i alt <b>${kr(total)}</b></p>
      ${list.length ? `<div class="receipt-grid">${list.map(card).join('')}</div>`
        : `<div class="empty glass"><div class="empty-emoji">📸</div><h3>${all.length ? 'Ingen kvitteringer matcher' : 'Ingen kvitteringer endnu'}</h3><p>${all.length ? 'Prøv at ændre filtrene.' : 'Tryk på "Scan kvittering" på telefonen for at tage et billede.'}</p></div>`}`}
  `;

  const bindVal = (id, key) => { const el = root.querySelector(id); if (!el) return; el.oninput = el.onchange = () => { ui[key] = el.value; render(root); }; };
  bindVal('#rc-q', 'q'); bindVal('#rc-cat', 'cat'); bindVal('#rc-who', 'who'); bindVal('#rc-from', 'from'); bindVal('#rc-to', 'to');
  bindVal('#rc-min', 'min'); bindVal('#rc-max', 'max'); bindVal('#rc-sort', 'sort');
  const label = state.budget.name;
  const filterText = [ui.q && `"${ui.q}"`, ui.cat, ui.who, ui.from && `fra ${fmtDate(ui.from)}`, ui.to && `til ${fmtDate(ui.to)}`, ui.min && `min ${ui.min} kr.`, ui.max && `max ${ui.max} kr.`].filter(Boolean).join(', ');
  bindExportButtons(root, 'rc-exp', { pdf: () => receiptsToPdf(list, label, filterText), xlsx: () => receiptsToExcel(list, label) });
  root.querySelector('#rc-reset').onclick = () => { Object.assign(ui, { q: '', from: '', to: '', cat: '', who: '', min: '', max: '' }); render(root); };
  const onFile = (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) openReceiptModal(null, f); };
  root.querySelector('#rc-cam')?.addEventListener('change', onFile);
  root.querySelector('#rc-file')?.addEventListener('change', onFile);
  root.querySelector('#rc-manual')?.addEventListener('click', () => openReceiptModal(null, null));
  root.querySelectorAll('[data-rc]').forEach((el) => (el.onclick = () => openReceiptModal(all.find((r) => r.id === el.dataset.rc))));
}

function filterSort(all) {
  const q = ui.q.trim().toLowerCase();
  const min = parseAmount(ui.min), max = parseAmount(ui.max);
  const out = all.filter((r) => {
    if (q && ![r.store, r.what, r.note, r.category, r.who].some((f) => String(f || '').toLowerCase().includes(q))) return false;
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
  }[ui.sort];
  return out.sort(cmp);
}

function card(r) {
  const isPdf = r.file?.contentType === 'application/pdf';
  return `<button class="receipt-card glass" data-rc="${r.id}">
    <div class="rc-thumb">${r.thumb ? `<img src="${r.thumb}" alt="" loading="lazy">` : `<span class="rc-ph">${isPdf ? 'PDF' : '🧾'}</span>`}</div>
    <div class="rc-body">
      <div class="rc-top"><b>${esc(r.store || 'Ukendt butik')}</b><span class="rc-amt">${kr(r.amount)}</span></div>
      <div class="rc-what">${esc(r.what || '')}</div>
      <div class="rc-meta">${esc(fmtDate(r.date))}${r.category ? ` · ${esc(r.category)}` : ''}${r.who ? ` · ${esc(r.who)}` : ''}</div>
    </div>
  </button>`;
}

export function openReceiptModal(rec = null, file = null) {
  const editing = !!rec;
  const readOnly = !canEdit();
  const people = lists().people;
  const meName = firstName(state.user.displayName);
  const r = rec || { date: isoDate(), who: people.includes(meName) ? meName : '' };
  let previewUrl = file && file.type.startsWith('image/') ? URL.createObjectURL(file) : null;

  const preview = previewUrl ? `<img src="${previewUrl}" alt="Kvittering">`
    : r.thumb ? `<img src="${r.thumb}" alt="Kvittering">`
    : file ? `<div class="rc-ph big">PDF · ${esc(file.name)}</div>`
    : r.file ? `<div class="rc-ph big">PDF</div>` : '';

  const body = `
    ${preview ? `<div class="rc-preview">${preview}${r.file ? '<button type="button" class="btn small ghost" data-open>Åbn original</button>' : ''}</div>` : ''}
    <div class="grid2">
      <label>Hvornår<input type="date" name="date" required value="${esc(r.date || '')}"></label>
      <label>Beløb (kr.)<input name="amount" inputmode="decimal" required value="${numToInput(r.amount)}" placeholder="0,00"></label>
    </div>
    <label>Butik${listSelect('store', 'suppliers', r.store, { placeholder: '— Vælg butik —' })}</label>
    <label>Hvad er købt<input name="what" maxlength="200" value="${esc(r.what)}" placeholder="f.eks. Vinterdæk, fødselsdagsgave, reservedel"></label>
    <div class="grid2">
      <label>Kategori${listSelect('category', 'categories', r.category)}</label>
      <label>Hvem${listSelect('who', 'people', r.who)}</label>
    </div>
    <label>Note (garanti, returret …)<textarea name="note" rows="2" maxlength="1000">${esc(r.note)}</textarea></label>
    <label>Garanti/returret udløber (valgfri)<input type="date" name="warrantyUntil" value="${esc(r.warrantyUntil || '')}"></label>
    ${editing && !file && !readOnly ? `<label class="file-replace">Erstat billede/PDF<input type="file" name="newfile" accept="image/*,application/pdf"></label>` : ''}
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
      form.querySelector('[data-open]')?.addEventListener('click', () => openFile(r.file).catch((e) => toast(e.message, 'error')));
    },
    onSubmit: async (fd) => {
      const amount = parseAmount(fd.get('amount'));
      if (Number.isNaN(amount)) { toast('Indtast et gyldigt beløb', 'error'); return false; }
      const data = {
        date: fd.get('date'), amount: Math.round(amount * 100) / 100, store: fd.get('store') || '',
        what: String(fd.get('what') || '').trim(), category: fd.get('category') || '', who: fd.get('who') || '',
        note: String(fd.get('note') || '').trim(), warrantyUntil: fd.get('warrantyUntil') || null,
      };
      const newFile = file || (fd.get('newfile')?.size ? fd.get('newfile') : null);
      if (newFile) {
        toast('Uploader …', 'ok', 1500);
        data.file = await uploadFile(newFile, 'receipts');
        data.thumb = await makeThumb(newFile).catch(() => null);
        if (rec?.file) await removeFile(rec.file).catch(() => {});
      }
      await saveRecord('receipts', rec?.id || null, data, rec);
      toast(editing ? 'Kvittering opdateret' : 'Kvittering gemt');
    },
  });
}
