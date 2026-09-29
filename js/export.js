// =====================================================================
//  export.js — PDF (jsPDF + AutoTable) og Excel (SheetJS), lavet direkte i browseren.
//  Bibliotekerne hentes først når man trykker på en eksport-knap.
// =====================================================================
import { fmtYm, fmtDate, toDate, isoDate, toast } from './ui.js';

const LIBS = {
  xlsx: 'https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js',
  jspdf: 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',
  autotable: 'https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.2/jspdf.plugin.autotable.min.js',
};
const loaded = {};
function loadScript(src) {
  loaded[src] ??= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src; s.async = true;
    s.onload = resolve;
    s.onerror = () => { delete loaded[src]; reject(new Error('Eksport-biblioteket kunne ikke hentes — tjek internetforbindelsen')); };
    document.head.appendChild(s);
  });
  return loaded[src];
}
async function getXLSX() { await loadScript(LIBS.xlsx); return window.XLSX; }
async function getJsPDF() { await loadScript(LIBS.jspdf); await loadScript(LIBS.autotable); return window.jspdf.jsPDF; }

export const safeFile = (s) => String(s || 'eksport').replace(/[\\/:*?"<>|]+/g, '').replace(/\s+/g, '_').slice(0, 80);
const nf = new Intl.NumberFormat('da-DK', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const nf0 = new Intl.NumberFormat('da-DK', { maximumFractionDigits: 0 });
// PDF-skrifttypen (Helvetica) kan kun Latin-1, så vi bruger almindelige mellemrum og bindestreger.
const pdfKr = (n, dec = true) => `${(dec ? nf : nf0).format(Math.abs(n) < 0.005 ? 0 : n)} kr.`.replace(/ | /g, ' ').replace(/−/g, '-');
const pdfText = (s) => String(s ?? '').replace(/[→←]/g, '->').replace(/[−]/g, '-').replace(/[^\u0000-ÿ–—‘’“”•…€]/g, '');

// ---------------------------------------------------------------------
//  Generisk Excel
//  sheets: [{ name, title, columns:[{header, key, type:'text'|'kr'|'int'|'date', width}], rows:[{}], totals:['key',...] }]
// ---------------------------------------------------------------------
export async function toExcel(filename, sheets) {
  const XLSX = await getXLSX();
  const wb = XLSX.utils.book_new();
  for (const sh of sheets) {
    const aoa = [];
    let r0 = 0;
    if (sh.title) { aoa.push([sh.title]); aoa.push([`Udarbejdet ${fmtDate(new Date())} med BudgetBasen`]); aoa.push([]); r0 = 3; }
    aoa.push(sh.columns.map((c) => c.header));
    for (const row of sh.rows) aoa.push(sh.columns.map((c) => cellValue(row[c.key], c.type)));
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    const first = r0 + 1, last = r0 + sh.rows.length; // 0-baseret: header = r0
    // Talformater
    sh.columns.forEach((c, ci) => {
      for (let r = first; r <= last; r++) {
        const cell = ws[XLSX.utils.encode_cell({ r, c: ci })];
        if (!cell) continue;
        if (c.type === 'kr' && cell.t === 'n') cell.z = '#,##0.00 "kr."';
        if (c.type === 'int' && cell.t === 'n') cell.z = '0';
        if (c.type === 'date' && cell.t === 'n') cell.z = 'dd-mm-yyyy';
      }
    });
    // Sum-række med rigtige formler (så tallene opdaterer sig, hvis man retter i arket)
    if (sh.totals?.length && sh.rows.length) {
      const tr = last + 1;
      XLSX.utils.sheet_add_aoa(ws, [sh.columns.map((c, ci) => (ci === 0 ? 'I alt' : null))], { origin: { r: tr, c: 0 } });
      sh.columns.forEach((c, ci) => {
        if (!sh.totals.includes(c.key)) return;
        const col = XLSX.utils.encode_col(ci);
        const sum = sh.rows.reduce((s, row) => s + (Number(row[c.key]) || 0), 0);
        ws[XLSX.utils.encode_cell({ r: tr, c: ci })] = { t: 'n', v: Math.round(sum * 100) / 100, f: `SUM(${col}${first + 1}:${col}${last + 1})`, z: c.type === 'kr' ? '#,##0.00 "kr."' : '0' };
      });
      ws['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: tr, c: sh.columns.length - 1 } });
    }
    ws['!cols'] = sh.columns.map((c) => ({ wch: c.width || Math.max(10, c.header.length + 2) }));
    if (sh.rows.length) ws['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: r0, c: 0 }, e: { r: last, c: sh.columns.length - 1 } }) };
    XLSX.utils.book_append_sheet(wb, ws, sh.name.slice(0, 31).replace(/[\\/?*[\]:]/g, ''));
  }
  XLSX.writeFile(wb, filename.endsWith('.xlsx') ? filename : `${filename}.xlsx`);
}
function cellValue(v, type) {
  if (v === null || v === undefined || v === '') return null;
  if (type === 'kr' || type === 'int') { const n = Number(v); return Number.isFinite(n) ? Math.round(n * 100) / 100 : null; }
  if (type === 'date') {
    // Excel-serienummer ud fra den lokale kalenderdato — undgår at SheetJS flytter datoen via tidszoner
    const d = toDate(v);
    return d ? (Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) - Date.UTC(1899, 11, 30)) / 864e5 : String(v);
  }
  return typeof v === 'boolean' ? (v ? 'Ja' : 'Nej') : String(v);
}

// ---------------------------------------------------------------------
//  Generisk PDF
//  doc: { title, subtitle, kpis:[{label, value}], sections:[{ heading, columns:[{header, align, width}], rows:[[..]], catRows:Set<idx>, foot:[..], thumbs:[dataURL|null] }], note, landscape }
// ---------------------------------------------------------------------
const ACCENT = [79, 95, 240], INK = [20, 26, 51], MUTED = [110, 118, 145], LINE = [225, 228, 240];

export async function toPdf(filename, d) {
  const JsPDF = await getJsPDF();
  const doc = new JsPDF({ orientation: d.landscape ? 'landscape' : 'portrait', unit: 'mm', format: 'a4' });
  const W = doc.internal.pageSize.getWidth();
  const M = 14;

  // Header-bånd
  doc.setFillColor(...ACCENT); doc.rect(0, 0, W, 28, 'F');
  doc.setTextColor(255); doc.setFont('helvetica', 'bold'); doc.setFontSize(17);
  doc.text(pdfText(d.title), M, 13);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5);
  doc.text(pdfText(d.subtitle || `Udarbejdet ${fmtDate(new Date())} med BudgetBasen`), M, 21);
  let y = 36;

  // Nøgletal
  if (d.kpis?.length) {
    const gap = 4, n = d.kpis.length, bw = (W - 2 * M - gap * (n - 1)) / n;
    d.kpis.forEach((k, i) => {
      const x = M + i * (bw + gap);
      doc.setDrawColor(...LINE); doc.setFillColor(247, 248, 253); doc.roundedRect(x, y, bw, 17, 2, 2, 'FD');
      doc.setTextColor(...MUTED); doc.setFontSize(8); doc.text(pdfText(k.label), x + 3, y + 6);
      doc.setTextColor(...(k.color || INK)); doc.setFont('helvetica', 'bold'); doc.setFontSize(11.5);
      doc.text(pdfText(k.value), x + 3, y + 13);
      doc.setFont('helvetica', 'normal');
    });
    y += 24;
  }

  for (const s of d.sections) {
    if (y > doc.internal.pageSize.getHeight() - 40) { doc.addPage(); y = 18; }
    doc.setTextColor(...INK); doc.setFont('helvetica', 'bold'); doc.setFontSize(12);
    doc.text(pdfText(s.heading), M, y); y += 3;
    doc.setFont('helvetica', 'normal');
    const hasThumbs = s.thumbs?.some(Boolean);
    const cols = hasThumbs ? [{ header: '', width: 14 }, ...s.columns] : s.columns;
    const body = s.rows.map((r, i) => (hasThumbs ? ['', ...r] : r).map((c) => pdfText(c)));
    doc.autoTable({
      startY: y + 1,
      head: [cols.map((c) => pdfText(c.header))],
      body,
      foot: s.foot ? [(hasThumbs ? ['', ...s.foot] : s.foot).map((c) => pdfText(c))] : undefined,
      showFoot: 'lastPage',
      margin: { left: M, right: M, bottom: 18 },
      theme: 'plain',
      styles: { font: 'helvetica', fontSize: 8.5, cellPadding: { top: 1.6, bottom: 1.6, left: 1.8, right: 1.8 }, textColor: INK, lineColor: LINE, lineWidth: { bottom: 0.2 }, overflow: 'linebreak', valign: 'middle' },
      headStyles: { fillColor: [238, 240, 252], textColor: ACCENT, fontStyle: 'bold', fontSize: 8 },
      footStyles: { fillColor: [238, 240, 252], textColor: INK, fontStyle: 'bold' },
      columnStyles: Object.fromEntries(cols.map((c, i) => [i, { halign: c.align || 'left', cellWidth: c.width || 'auto' }])),
      didParseCell: (data) => {
        const idx = cols[data.column.index];
        if (data.section !== 'body' && idx?.align === 'right') data.cell.styles.halign = 'right';
        if (data.section === 'body' && hasThumbs) data.cell.styles.minCellHeight = 16;
        if (data.section === 'body' && s.catRows?.has(data.row.index)) { data.cell.styles.fontStyle = 'bold'; data.cell.styles.fillColor = [246, 247, 251]; }
        if (data.section === 'body' && s.negCols?.includes(data.column.index - (hasThumbs ? 1 : 0)) && /^-/.test(String(data.cell.raw))) data.cell.styles.textColor = [200, 40, 70];
      },
      didDrawCell: (data) => {
        if (!hasThumbs || data.section !== 'body' || data.column.index !== 0) return;
        const src = s.thumbs[data.row.index];
        if (!src) return;
        try {
          const p = doc.getImageProperties(src);
          const h = data.cell.height - 2, w = Math.min(12, (p.width / p.height) * h);
          doc.addImage(src, 'JPEG', data.cell.x + 1, data.cell.y + 1, w, h);
        } catch { /* ugyldigt billede */ }
      },
    });
    y = doc.lastAutoTable.finalY + 10;
  }

  if (d.note) {
    if (y > doc.internal.pageSize.getHeight() - 25) { doc.addPage(); y = 18; }
    doc.setTextColor(...MUTED); doc.setFontSize(8);
    doc.text(doc.splitTextToSize(pdfText(d.note), W - 2 * M), M, y);
  }

  // Sidefod på alle sider
  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    const H = doc.internal.pageSize.getHeight();
    doc.setDrawColor(...LINE); doc.line(M, H - 11, W - M, H - 11);
    doc.setTextColor(...MUTED); doc.setFontSize(7.5);
    doc.text(pdfText(`BudgetBasen · ${d.title}`), M, H - 6.5);
    doc.text(`Side ${i} af ${pages}`, W - M, H - 6.5, { align: 'right' });
  }
  doc.save(filename.endsWith('.pdf') ? filename : `${filename}.pdf`);
}

/** Kører en eksport med "arbejder…"-feedback og fejlbesked. */
export async function runExport(btn, fn) {
  const label = btn?.textContent;
  if (btn) { btn.disabled = true; btn.textContent = 'Laver fil…'; }
  try { await fn(); toast('Filen er hentet'); } catch (e) { console.error(e); toast(e.message || 'Eksporten fejlede', 'error', 5000); }
  finally { if (btn) { btn.disabled = false; btn.textContent = label; } }
}

/** Én knap "Hent / del", der åbner et lille valg med forklaring af hver filtype. */
export const exportButtons = (id) => `<button type="button" class="btn small ghost export-btn" id="${id}">
  <svg viewBox="0 0 24 24"><path d="M12 3v12M7 10l5 5 5-5"/><path d="M5 21h14"/></svg>Hent / del</button>`;

export function bindExportButtons(root, id, { pdf, xlsx, what = '' }) {
  const btn = root.querySelector(`#${id}`);
  if (!btn) return;
  btn.onclick = () => openExportChoice({ pdf, xlsx, what });
}

export async function openExportChoice({ pdf, xlsx, what = '', title = 'Hent som fil' }) {
  const { openModal } = await import('./ui.js');
  const m = openModal({
    title,
    body: `${what ? `<p class="muted">${what}</p>` : ''}
      <div class="exp-choices">
        <button type="button" class="exp-opt" data-k="pdf"><span class="exp-ico">📄</span><span><b>PDF</b><small>En færdig side — til at printe, gemme på telefonen eller sende til banken.</small></span></button>
        <button type="button" class="exp-opt" data-k="xlsx"><span class="exp-ico">📊</span><span><b>Excel</b><small>Et regneark — hvis du selv vil regne videre, sortere eller rette i tallene.</small></span></button>
      </div>`,
    onOpen: (form) => form.querySelectorAll('.exp-opt').forEach((b) => (b.onclick = async () => {
      await runExport(b, b.dataset.k === 'pdf' ? pdf : xlsx);
      m.close();
    })),
  });
}

// =====================================================================
//  Konkrete eksporter
// =====================================================================

// ---------- Budgetrapport (Del / eksportér + offentligt link) ----------
export async function reportToPdf(r) {
  const o = r.opts || {};
  const extra = [o.supplier && ['Leverandør', 'supplier'], o.who && ['Hvem', 'who'], o.account && ['Konto', 'account']].filter(Boolean);
  const columns = [{ header: 'Post' }, ...extra.map(([h]) => ({ header: h })), { header: 'Frekvens' }, { header: 'Beløb', align: 'right' }, { header: 'Pr. md.', align: 'right' }];
  const sections = [];
  for (const type of ['income', 'expense']) {
    const secs = r.sections.filter((s) => s.type === type);
    if (!secs.length) continue;
    const rows = [], catRows = new Set();
    for (const s of secs) {
      catRows.add(rows.length);
      rows.push([s.category, ...extra.map(() => ''), '', '', pdfKr(s.total)]);
      for (const i of s.items) rows.push([i.note && o.note ? `${i.name}\n${i.note}` : i.name, ...extra.map(([, k]) => i[k] || ''), i.freqLabel, pdfKr(i.amount), pdfKr(i.monthly)]);
    }
    const total = secs.reduce((a, s) => a + s.total, 0);
    sections.push({ heading: type === 'income' ? 'Indtægter' : 'Udgifter', columns, rows, catRows, foot: ['I alt pr. måned', ...extra.map(() => ''), '', '', pdfKr(total)] });
  }
  if (r.cashflow) sections.push(cashflowSection(r.cashflow));
  await toPdf(safeFile(r.title), {
    title: r.title, subtitle: `Udarbejdet ${fmtDate(r.generated)} med BudgetBasen`,
    kpis: reportKpis(r.totals), sections,
    note: o.selectedTotals === false ? 'Totaler omfatter alle aktive poster, også dem der ikke er vist.' : '',
  });
}
function reportKpis(t) {
  return [
    { label: 'Indtægter pr. md.', value: pdfKr(t.income), color: [14, 140, 90] },
    { label: 'Udgifter pr. md.', value: pdfKr(t.expense) },
    { label: 'Rådighed pr. md.', value: pdfKr(t.net), color: t.net < 0 ? [200, 40, 70] : [14, 140, 90] },
    { label: 'Pr. år', value: pdfKr(t.yearNet, false), color: t.yearNet < 0 ? [200, 40, 70] : INK },
  ];
}
function cashflowSection(months) {
  return {
    heading: 'Likviditet måned for måned',
    columns: [{ header: 'Måned' }, { header: 'Start', align: 'right' }, { header: 'Ind', align: 'right' }, { header: 'Ud', align: 'right' }, { header: 'Laveste', align: 'right' }, { header: 'Slut', align: 'right' }],
    rows: months.map((m) => [fmtYm(m.ym, true), pdfKr(m.start, false), pdfKr(m.income, false), pdfKr(m.expense, false), pdfKr(m.min, false) + (m.minDay ? ` (d. ${m.minDay}.)` : ''), pdfKr(m.end, false)]),
    negCols: [1, 4, 5],
  };
}

export async function reportToExcel(r) {
  const o = r.opts || {};
  const rows = [];
  for (const s of r.sections) for (const i of s.items) {
    rows.push({ type: s.type === 'income' ? 'Indtægt' : 'Udgift', category: s.category, name: i.name, supplier: i.supplier, who: i.who, account: i.account, freq: i.freqLabel, amount: i.amount, monthly: i.monthly, yearly: Math.round(i.monthly * 1200) / 100, note: i.note });
  }
  const cols = [
    { header: 'Type', key: 'type', width: 10 }, { header: 'Kategori', key: 'category', width: 18 }, { header: 'Post', key: 'name', width: 28 },
    o.supplier && { header: 'Leverandør', key: 'supplier', width: 18 }, o.who && { header: 'Hvem', key: 'who', width: 12 }, o.account && { header: 'Konto', key: 'account', width: 14 },
    { header: 'Frekvens', key: 'freq', width: 20 }, { header: 'Beløb pr. betaling', key: 'amount', type: 'kr', width: 18 },
    { header: 'Pr. måned', key: 'monthly', type: 'kr', width: 15 }, { header: 'Pr. år', key: 'yearly', type: 'kr', width: 15 },
    o.note && { header: 'Note', key: 'note', width: 40 },
  ].filter(Boolean);
  const t = r.totals;
  const sheets = [
    { name: 'Oversigt', title: r.title, columns: [{ header: 'Nøgletal', key: 'k', width: 26 }, { header: 'Pr. måned', key: 'm', type: 'kr', width: 18 }, { header: 'Pr. år', key: 'y', type: 'kr', width: 18 }],
      rows: [{ k: 'Indtægter', m: t.income, y: t.income * 12 }, { k: 'Udgifter', m: t.expense, y: t.expense * 12 }, { k: 'Rådighed / overskud', m: t.net, y: t.yearNet }] },
    { name: 'Poster', columns: cols, rows, totals: [] },
  ];
  // Udgifter og indtægter summeres separat — en fælles sum giver ikke mening
  sheets.push({ name: 'Pr. kategori', columns: [{ header: 'Type', key: 'type', width: 10 }, { header: 'Kategori', key: 'category', width: 22 }, { header: 'Pr. måned', key: 'total', type: 'kr', width: 16 }, { header: 'Pr. år', key: 'year', type: 'kr', width: 16 }],
    rows: r.sections.map((s) => ({ type: s.type === 'income' ? 'Indtægt' : 'Udgift', category: s.category, total: s.total, year: s.total * 12 })) });
  if (r.cashflow) sheets.push(cashflowSheet(r.cashflow));
  await toExcel(safeFile(r.title), sheets);
}
function cashflowSheet(months) {
  return {
    name: 'Likviditet',
    columns: [{ header: 'Måned', key: 'm', width: 16 }, { header: 'Start', key: 'start', type: 'kr', width: 15 }, { header: 'Ind', key: 'income', type: 'kr', width: 15 }, { header: 'Ud', key: 'expense', type: 'kr', width: 15 }, { header: 'Netto', key: 'net', type: 'kr', width: 15 }, { header: 'Laveste', key: 'min', type: 'kr', width: 15 }, { header: 'Laveste dag', key: 'minDay', type: 'int', width: 12 }, { header: 'Slut', key: 'end', type: 'kr', width: 15 }],
    rows: months.map((m) => ({ ...m, m: fmtYm(m.ym, true), net: m.income - m.expense })),
    totals: ['income', 'expense', 'net'],
  };
}

// ---------- Likviditet ----------
export async function cashflowToPdf({ title, accountLabel, startBalance, cf, yearEnd, calYear, year }) {
  const events = [];
  for (const m of cf.months) for (const e of m.events) events.push([`${e.day}. ${fmtYm(m.ym)}`, e.name, e.account || '', pdfKr(e.amount), pdfKr(e.balance)]);
  await toPdf(safeFile(`Likviditet_${accountLabel}`), {
    title, subtitle: `${accountLabel} · startsaldo ${pdfKr(startBalance)} · udarbejdet ${fmtDate(new Date())}`,
    kpis: [
      { label: 'Startsaldo', value: pdfKr(startBalance) },
      { label: `Laveste punkt (${fmtDate(cf.lowest.date)})`, value: pdfKr(cf.lowest.amount), color: cf.lowest.amount < 0 ? [200, 40, 70] : INK },
      { label: `Saldo 31. dec. ${year}`, value: yearEnd === null ? '-' : pdfKr(yearEnd), color: yearEnd < 0 ? [200, 40, 70] : INK },
      { label: `Årets resultat ${year}`, value: pdfKr(calYear.net), color: calYear.net < 0 ? [200, 40, 70] : [14, 140, 90] },
    ],
    sections: [
      cashflowSection(cf.months),
      { heading: 'Alle betalinger i perioden', columns: [{ header: 'Dato' }, { header: 'Post' }, { header: 'Konto' }, { header: 'Beløb', align: 'right' }, { header: 'Saldo efter', align: 'right' }], rows: events, negCols: [3, 4] },
    ],
    note: cf.firstNegative ? `Advarsel: kontoen går i minus i ${fmtYm(cf.firstNegative.ym, true)}. Laveste saldo ${pdfKr(cf.lowest.amount)} den ${fmtDate(cf.lowest.date)}.` : 'Kontoen holder sig i plus i hele perioden.',
  });
}
export async function cashflowToExcel({ title, accountLabel, cf }) {
  const events = [];
  for (const m of cf.months) for (const e of m.events) {
    const [y, mo] = m.ym.split('-').map(Number);
    events.push({ date: new Date(y, mo - 1, e.day), name: e.name, account: e.account, type: e.amount < 0 ? 'Udgift' : 'Indtægt', amount: e.amount, balance: e.balance });
  }
  await toExcel(safeFile(`Likviditet_${accountLabel}`), [
    { ...cashflowSheet(cf.months), title: `${title} · ${accountLabel}` },
    { name: 'Betalinger', columns: [{ header: 'Dato', key: 'date', type: 'date', width: 12 }, { header: 'Post', key: 'name', width: 28 }, { header: 'Konto', key: 'account', width: 14 }, { header: 'Type', key: 'type', width: 10 }, { header: 'Beløb', key: 'amount', type: 'kr', width: 15 }, { header: 'Saldo efter', key: 'balance', type: 'kr', width: 15 }], rows: events },
  ]);
}

// ---------- Kvitteringer ----------
const receiptCols = [
  { header: 'Dato', key: 'date', type: 'date', width: 12 }, { header: 'Butik', key: 'store', width: 20 }, { header: 'Hvad', key: 'what', width: 28 },
  { header: 'Kategori', key: 'category', width: 16 }, { header: 'Hvem', key: 'who', width: 12 }, { header: 'Beløb', key: 'amount', type: 'kr', width: 14 },
  { header: 'Garanti/returret til', key: 'warrantyUntil', type: 'date', width: 18 }, { header: 'Note', key: 'note', width: 36 }, { header: 'Fil vedhæftet', key: 'hasFile', width: 12 },
];
export async function receiptsToExcel(list, label) {
  await toExcel(safeFile(`Kvitteringer_${label}`), [{ name: 'Kvitteringer', title: `Kvitteringer · ${label}`, columns: receiptCols, rows: list.map((r) => ({ ...r, hasFile: r.file ? 'Ja' : 'Nej' })), totals: ['amount'] }]);
}
export async function receiptsToPdf(list, label, filterText) {
  const total = list.reduce((s, r) => s + (Number(r.amount) || 0), 0);
  await toPdf(safeFile(`Kvitteringer_${label}`), {
    title: `Kvitteringer · ${label}`, subtitle: `${list.length} kvitteringer${filterText ? ` · filter: ${filterText}` : ''} · udarbejdet ${fmtDate(new Date())}`,
    kpis: [{ label: 'Antal', value: String(list.length) }, { label: 'I alt', value: pdfKr(total) }],
    sections: [{
      heading: 'Oversigt',
      columns: [{ header: 'Dato', width: 22 }, { header: 'Butik' }, { header: 'Hvad' }, { header: 'Kategori' }, { header: 'Hvem' }, { header: 'Beløb', align: 'right' }],
      rows: list.map((r) => [fmtDate(r.date), r.store || '', [r.what, r.warrantyUntil && `Garanti til ${fmtDate(r.warrantyUntil)}`].filter(Boolean).join('\n'), r.category || '', r.who || '', pdfKr(r.amount)]),
      thumbs: list.map((r) => r.thumb || null),
      foot: ['I alt', '', '', '', '', pdfKr(total)],
    }],
  });
}

// ---------- Dokumenter ----------
export async function documentsToExcel(list, deadlineOf, itemName, label) {
  const rows = list.map((d) => ({ ...d, deadline: deadlineOf(d), monthly: d.yearlyPrice ? d.yearlyPrice / 12 : null, linked: itemName(d.linkedItemId), fileCount: (d.files || []).length }));
  await toExcel(safeFile(`Dokumenter_${label}`), [{
    name: 'Dokumenter', title: `Dokumenter & kontrakter · ${label}`,
    columns: [
      { header: 'Titel', key: 'title', width: 28 }, { header: 'Type', key: 'docType', width: 14 }, { header: 'Selskab', key: 'supplier', width: 18 },
      { header: 'Police-/kontraktnr.', key: 'reference', width: 18 }, { header: 'Start', key: 'startDate', type: 'date', width: 12 },
      { header: 'Udløb/fornyelse', key: 'expiryDate', type: 'date', width: 15 }, { header: 'Varsel (mdr.)', key: 'noticeMonths', type: 'int', width: 12 },
      { header: 'Opsig senest', key: 'deadline', type: 'date', width: 13 }, { header: 'Årlig pris', key: 'yearlyPrice', type: 'kr', width: 14 },
      { header: 'Pr. måned', key: 'monthly', type: 'kr', width: 13 }, { header: 'Budgetpost', key: 'linked', width: 20 }, { header: 'Filer', key: 'fileCount', type: 'int', width: 7 }, { header: 'Note', key: 'note', width: 40 },
    ],
    rows, totals: ['yearlyPrice', 'monthly'],
  }]);
}
export async function documentsToPdf(list, deadlineOf, label) {
  const total = list.reduce((s, d) => s + (Number(d.yearlyPrice) || 0), 0);
  await toPdf(safeFile(`Dokumenter_${label}`), {
    title: `Dokumenter & kontrakter · ${label}`, landscape: true,
    kpis: [{ label: 'Antal dokumenter', value: String(list.length) }, { label: 'Samlet årlig pris', value: pdfKr(total) }, { label: 'Pr. måned', value: pdfKr(total / 12) }],
    sections: [{
      heading: 'Oversigt',
      columns: [{ header: 'Titel' }, { header: 'Type' }, { header: 'Selskab' }, { header: 'Nr.' }, { header: 'Udløb' }, { header: 'Opsig senest' }, { header: 'Årlig pris', align: 'right' }],
      rows: list.map((d) => [d.title, d.docType || '', d.supplier || '', d.reference || '', fmtDate(d.expiryDate), fmtDate(deadlineOf(d)), d.yearlyPrice ? pdfKr(d.yearlyPrice) : '']),
      foot: ['I alt', '', '', '', '', '', pdfKr(total)],
    }],
  });
}

// ---------- Fuld backup (Admin → Eksport) ----------
export async function fullBackupToExcel({ budget, items, receipts, documents, freqLabel, monthly, deadlineOf }) {
  const itemRows = items.map((i) => ({ ...i, type: i.type === 'income' ? 'Indtægt' : 'Udgift', freqTxt: freqLabel(i.freq), monthly: monthly(i), active: i.active === false ? 'Nej' : 'Ja', private: i.private ? 'Ja' : 'Nej' }));
  const L = budget.lists || {};
  const maxLen = Math.max(0, ...Object.values(L).filter(Array.isArray).map((a) => a.length));
  const listRows = Array.from({ length: maxLen }, (_, r) => ({
    categories: L.categories?.[r], people: L.people?.[r], suppliers: L.suppliers?.[r], methods: L.methods?.[r], accounts: L.accounts?.[r], docTypes: L.docTypes?.[r],
    frequencies: L.frequencies?.[r] ? `${L.frequencies[r].label} (${L.frequencies[r].months} mdr.)` : null,
  }));
  await toExcel(safeFile(`${budget.name}_backup_${isoDate()}`), [
    { name: 'Poster', title: `${budget.name} · alle budgetposter`, columns: [
      { header: 'Type', key: 'type', width: 10 }, { header: 'Kategori', key: 'category', width: 18 }, { header: 'Navn', key: 'name', width: 26 },
      { header: 'Beløb', key: 'amount', type: 'kr', width: 14 }, { header: 'Frekvens', key: 'freqTxt', width: 20 }, { header: 'Pr. måned', key: 'monthly', type: 'kr', width: 14 },
      { header: 'Første betaling', key: 'startMonth', width: 14 }, { header: 'Betalingsdag', key: 'payDay', type: 'int', width: 12 }, { header: 'Slutter', key: 'endMonth', width: 10 },
      { header: 'Hvem', key: 'who', width: 12 }, { header: 'Leverandør', key: 'supplier', width: 18 }, { header: 'Metode', key: 'method', width: 16 }, { header: 'Konto', key: 'account', width: 14 },
      { header: 'Aktiv', key: 'active', width: 7 }, { header: 'Privat', key: 'private', width: 7 }, { header: 'Note', key: 'note', width: 40 },
    ], rows: itemRows },
    { name: 'Kvitteringer', columns: receiptCols, rows: receipts.map((r) => ({ ...r, hasFile: r.file ? 'Ja' : 'Nej' })), totals: ['amount'] },
    { name: 'Dokumenter', columns: [
      { header: 'Titel', key: 'title', width: 28 }, { header: 'Type', key: 'docType', width: 14 }, { header: 'Selskab', key: 'supplier', width: 18 }, { header: 'Nr.', key: 'reference', width: 16 },
      { header: 'Start', key: 'startDate', type: 'date', width: 12 }, { header: 'Udløb', key: 'expiryDate', type: 'date', width: 12 }, { header: 'Opsig senest', key: 'deadline', type: 'date', width: 13 },
      { header: 'Årlig pris', key: 'yearlyPrice', type: 'kr', width: 14 }, { header: 'Note', key: 'note', width: 40 },
    ], rows: documents.map((d) => ({ ...d, deadline: deadlineOf(d) })), totals: ['yearlyPrice'] },
    { name: 'Kontosaldi', columns: [{ header: 'Konto', key: 'account', width: 18 }, { header: 'Saldo', key: 'amount', type: 'kr', width: 16 }, { header: 'Dato', key: 'date', type: 'date', width: 12 }], rows: budget.settings?.balances || [] },
    { name: 'Lister', columns: [
      { header: 'Kategorier', key: 'categories', width: 20 }, { header: 'Personer', key: 'people', width: 14 }, { header: 'Leverandører', key: 'suppliers', width: 20 },
      { header: 'Metoder', key: 'methods', width: 18 }, { header: 'Konti', key: 'accounts', width: 16 }, { header: 'Dokumenttyper', key: 'docTypes', width: 16 }, { header: 'Frekvenser', key: 'frequencies', width: 28 },
    ], rows: listRows },
  ]);
}
