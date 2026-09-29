// Dokumenter & kontrakter: forsikringspolicer, lejekontrakter, abonnementer — med udløbs- og opsigelsesfrister.
import { state, canEdit, lists, isShared, visibilityLabel, defaultVisibleTo } from '../state.js';
import { esc, kr, fmtDate, openModal, confirmDialog, toast, parseAmount, numToInput, toDate } from '../ui.js';
import { watch, saveRecord, deleteRecord } from '../data.js';
import { uploadFile, openFile, removeFile, fileSize } from '../files.js';
import { listSelect, filterSelect, bindListSelects, visibilityPicker, bindVisibility, readVisibility } from '../forms.js';
import { exportButtons, bindExportButtons, documentsToPdf, documentsToExcel } from '../export.js';

const ui = { q: '', type: '' };
const DAY = 864e5;

/** Sidste dag man kan opsige = udløbsdato minus opsigelsesvarsel (i måneder). */
export function noticeDeadline(d) {
  const exp = toDate(d.expiryDate);
  if (!exp) return null;
  const n = Number(d.noticeMonths) || 0;
  const x = new Date(exp);
  x.setMonth(x.getMonth() - n);
  if (x.getDate() !== exp.getDate()) x.setDate(0); // 31. maj − 3 mdr → 28./29. feb
  return x;
}
function status(d, today = new Date()) {
  const exp = toDate(d.expiryDate);
  if (!exp) return null;
  const dl = noticeDeadline(d);
  const daysToDl = Math.ceil((dl - today) / DAY);
  const daysToExp = Math.ceil((exp - today) / DAY);
  if (daysToExp < 0) return { cls: 'neg', text: `Udløbet ${fmtDate(exp)}`, days: daysToExp };
  if (daysToDl < 0) return { cls: 'warn', text: `Opsigelsesfrist overskredet · fornyes ${fmtDate(exp)}`, days: daysToExp };
  if (daysToDl <= 60) return { cls: 'warn', text: `Opsig senest ${fmtDate(dl)} (${daysToDl} dage)`, days: daysToDl };
  return { cls: 'ok', text: `Udløber/fornyes ${fmtDate(exp)}`, days: daysToDl };
}

export function render(root) {
  watch('documents');
  const L = lists();
  const key = `documents:${state.budgetId}:${canEdit()}:${JSON.stringify(L.docTypes)}`;
  if (root.dataset.shell !== key) {
    root.dataset.shell = key;
    root.innerHTML = `<div class="view-wrap">
      <section class="toolbar glass">
        <div class="toolbar-row">
          <input id="dc-q" type="search" placeholder="Søg i dokumenter…" value="${esc(ui.q)}" enterkeyhint="search" autocomplete="off">
          ${filterSelect('dc-type', 'docTypes', ui.type, 'Alle typer')}
          ${canEdit() ? '<button class="btn primary" id="dc-add" type="button">＋ Nyt dokument</button>' : ''}
        </div>
      </section>
      <div id="dc-results"></div></div>`;
    const w = root.firstElementChild;
    const qi = w.querySelector('#dc-q');
    qi.addEventListener('input', () => { ui.q = qi.value; update(root); });
    qi.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); qi.blur(); } });
    w.querySelector('#dc-type').onchange = (e) => { ui.type = e.target.value; update(root); };
    w.querySelector('#dc-add')?.addEventListener('click', () => openDocModal());
    w.addEventListener('click', (e) => {
      const el = e.target.closest('[data-doc]');
      if (!el) return;
      e.preventDefault();
      openDocModal((state.col.documents || []).find((d) => d.id === el.dataset.doc));
    });
  }
  update(root);
}

function update(root) {
  const all = state.col.documents;
  const out = root.querySelector('#dc-results');
  if (!all) { out.innerHTML = '<div class="skeleton"></div>'; return; }
  const q = ui.q.trim().toLowerCase();
  const list = all.filter((d) => (!ui.type || d.docType === ui.type)
    && (!q || [d.title, d.supplier, d.reference, d.note, d.docType].some((f) => String(f || '').toLowerCase().includes(q))));
  const upcoming = all.map((d) => ({ d, s: status(d) })).filter((x) => x.s && x.s.cls !== 'ok' && x.s.days > -30).sort((a, b) => a.s.days - b.s.days);
  const yearly = list.reduce((s, d) => s + (Number(d.yearlyPrice) || 0), 0);
  const groups = new Map();
  for (const d of list) { const t = d.docType || 'Andet'; if (!groups.has(t)) groups.set(t, []); groups.get(t).push(d); }

  out.innerHTML = `
    ${upcoming.length ? `<section class="alert warn glass"><b>⏰ Frister du skal huske</b>
      <ul class="plain">${upcoming.map(({ d, s }) => `<li><a href="#" data-doc="${d.id}">${esc(d.title)}</a> — ${esc(s.text)}</li>`).join('')}</ul></section>` : ''}
    ${!all.length ? `<div class="empty glass"><div class="empty-emoji">📁</div><h3>Ingen dokumenter endnu</h3>
      <p>Saml forsikringspolicer, lejekontrakter, abonnementer og garantibeviser her — adskilt fra de daglige kvitteringer. Appen holder øje med, hvornår de skal opsiges.</p></div>`
    : `<div class="result-bar"><p class="result-line">${list.length} dokumenter · koster i alt <b>${kr(yearly)}</b> om året</p>${list.length ? exportButtons('dc-exp') : ''}</div>
      ${list.length ? [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0], 'da')).map(([t, docs]) => `
        <details class="group glass" open>
          <summary><span class="chev"></span><span class="g-name">${esc(t)}</span><span class="g-count">${docs.length}</span></summary>
          <div class="doc-list">${docs.sort((a, b) => String(a.title).localeCompare(String(b.title), 'da')).map(docCard).join('')}</div>
        </details>`).join('') : '<div class="empty glass small"><p>Ingen dokumenter passer til søgningen.</p></div>'}`}`;

  const itemName = (id) => state.items.find((i) => i.id === id)?.name || '';
  bindExportButtons(out, 'dc-exp', {
    what: `Oversigt over ${list.length} dokumenter med udløb, opsigelsesfrister og pris.`,
    pdf: () => documentsToPdf(list, noticeDeadline, state.budget.name), xlsx: () => documentsToExcel(list, noticeDeadline, itemName, state.budget.name),
  });
}

function docCard(d) {
  const s = status(d);
  const linked = d.linkedItemId ? state.items.find((i) => i.id === d.linkedItemId) : null;
  return `<button class="doc-card" data-doc="${d.id}">
    <div class="doc-icon">${(d.files || []).length ? '📎' : '📄'}</div>
    <div class="doc-main">
      <b>${esc(d.title)}${!isShared(d) ? ` <span class="vis-tag">🔒 ${esc(visibilityLabel(d))}</span>` : ''}</b>
      <div class="muted small">${[d.supplier, d.reference && `Nr. ${d.reference}`, linked && `↔ ${linked.name}`].filter(Boolean).map(esc).join(' · ')}</div>
      ${s ? `<span class="chip ${s.cls}">${esc(s.text)}</span>` : ''}
    </div>
    <div class="doc-price">${d.yearlyPrice ? `${kr(d.yearlyPrice, false)}<small>/år</small>` : ''}</div>
  </button>`;
}

export function openDocModal(rec = null) {
  const editing = !!rec;
  const readOnly = !canEdit();
  const d = rec || { docType: '', files: [], visibleTo: defaultVisibleTo() };
  let files = [...(d.files || [])];
  const removed = [];
  const expenseItems = state.items.filter((i) => i.type === 'expense').sort((a, b) => a.name.localeCompare(b.name, 'da'));

  const filesHtml = () => files.length ? files.map((f, i) => `
    <li><button type="button" class="link" data-open="${i}">${esc(f.name)}</button><span class="muted small">${fileSize(f.size || 0)}</span>
    ${readOnly ? '' : `<button type="button" class="icon-btn" data-rm="${i}" aria-label="Fjern">✕</button>`}</li>`).join('') : '<li class="muted small">Ingen filer</li>';

  const body = `
    <label>Titel<input name="title" required maxlength="160" value="${esc(d.title)}" placeholder="f.eks. Indboforsikring, Lejekontrakt Vestergade"></label>
    <div class="grid2">
      <label>Type${listSelect('docType', 'docTypes', d.docType, { required: true })}</label>
      <label>Selskab / udbyder${listSelect('supplier', 'suppliers', d.supplier)}</label>
    </div>
    <div class="grid2">
      <label>Police-/kunde-/kontraktnr.<input name="reference" maxlength="80" value="${esc(d.reference)}"></label>
      <label>Årlig pris (kr.)<input name="yearlyPrice" inputmode="decimal" value="${numToInput(d.yearlyPrice)}"></label>
    </div>
    <div class="grid3">
      <label>Startdato<input type="date" name="startDate" value="${esc(d.startDate || '')}"></label>
      <label>Udløb / fornyelse<input type="date" name="expiryDate" value="${esc(d.expiryDate || '')}"></label>
      <label>Opsigelsesvarsel (mdr.)<input type="number" name="noticeMonths" min="0" max="36" value="${esc(d.noticeMonths ?? '')}"></label>
    </div>
    <label>Kobl til budgetpost
      <select name="linkedItemId"><option value="">— Ingen —</option>${expenseItems.map((i) => `<option value="${i.id}" ${i.id === d.linkedItemId ? 'selected' : ''}>${esc(i.name)}</option>`).join('')}</select>
    </label>
    <label>Noter (dækning, selvrisiko, kontaktperson …)<textarea name="note" rows="3" maxlength="2000">${esc(d.note)}</textarea></label>
    ${visibilityPicker(d)}
    <div class="files-box">
      <b>Filer</b>
      <ul class="file-list" id="doc-files">${filesHtml()}</ul>
      ${readOnly ? '' : '<label class="btn small ghost">＋ Tilføj filer (billede/PDF)<input type="file" name="newfiles" accept="image/*,application/pdf" multiple hidden></label><span class="muted small" id="doc-new"></span>'}
    </div>`;

  const buttons = editing && !readOnly ? [{ label: 'Slet', cls: 'danger-ghost', onClick: async () => {
    if (!(await confirmDialog(`Slet <b>${esc(d.title)}</b> og alle vedhæftede filer?`))) return false;
    await deleteRecord('documents', rec); toast('Dokument slettet');
  } }] : [];

  openModal({
    title: editing ? d.title : 'Nyt dokument', body, readOnly, buttons, wide: true,
    submitLabel: editing ? 'Gem' : 'Opret dokument',
    onOpen: (form) => {
      bindListSelects(form);
      bindVisibility(form);
      const ul = form.querySelector('#doc-files');
      ul.addEventListener('click', (e) => {
        const o = e.target.closest('[data-open]'); const r = e.target.closest('[data-rm]');
        if (o) openFile(files[Number(o.dataset.open)]).catch((err) => toast(err.message, 'error'));
        if (r) { removed.push(...files.splice(Number(r.dataset.rm), 1)); ul.innerHTML = filesHtml(); }
      });
      form.newfiles?.addEventListener('change', () => {
        const n = form.newfiles.files.length;
        form.querySelector('#doc-new').textContent = n ? `${n} fil(er) uploades ved gem` : '';
      });
    },
    onSubmit: async (fd, form) => {
      const price = fd.get('yearlyPrice') ? parseAmount(fd.get('yearlyPrice')) : null;
      if (price !== null && Number.isNaN(price)) { toast('Ugyldig pris', 'error'); return false; }
      const newFiles = [...(form.newfiles?.files || [])];
      if (newFiles.length) toast(`Uploader ${newFiles.length} fil(er) …`, 'ok', 2000);
      for (const f of newFiles) files.push(await uploadFile(f, 'documents'));
      for (const f of removed) await removeFile(f).catch(() => {});
      const data = {
        title: String(fd.get('title')).trim(), docType: fd.get('docType') || '', supplier: fd.get('supplier') || '',
        reference: String(fd.get('reference') || '').trim(), yearlyPrice: price,
        startDate: fd.get('startDate') || null, expiryDate: fd.get('expiryDate') || null,
        noticeMonths: fd.get('noticeMonths') === '' ? null : Number(fd.get('noticeMonths')),
        linkedItemId: fd.get('linkedItemId') || null, note: String(fd.get('note') || '').trim(), files, visibleTo: readVisibility(form),
      };
      await saveRecord('documents', rec?.id || null, data, rec);
      toast(editing ? 'Dokument gemt' : 'Dokument oprettet');
    },
  });
}
