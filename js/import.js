// Import af poster fra Excel/CSV: hent skabelon, udfyld, upload, se listen igennem, gem.
import { state, lists, defaultVisibleTo, TYPE_LABEL } from './state.js';
import { esc, kr, openModal, toast, errorToast, currentYm } from './ui.js';
import { getXLSX } from './export.js';
import { saveItem, budgetRef } from './data.js';
import { updateDoc, serverTimestamp } from './firebase.js';
import { freqLabel } from './calc.js';
import { parseImportRows, IMPORT_COLUMNS, IMPORT_EXAMPLES, IMPORT_HELP } from './importparse.js';

async function downloadTemplate() {
  const XLSX = await getXLSX();
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([IMPORT_COLUMNS, ...IMPORT_EXAMPLES]);
  ws['!cols'] = [12, 24, 12, 16, 8, 14, 18, 18, 12, 20, 24].map((wch) => ({ wch }));
  XLSX.utils.book_append_sheet(wb, ws, 'Poster');
  const help = XLSX.utils.aoa_to_sheet(IMPORT_HELP);
  help['!cols'] = [{ wch: 16 }, { wch: 110 }];
  XLSX.utils.book_append_sheet(wb, help, 'Vejledning');
  XLSX.writeFile(wb, 'BudgetBasen-import-skabelon.xlsx');
}

async function readFile(file) {
  const XLSX = await getXLSX();
  const isCsv = /\.csv$/i.test(file.name);
  const wb = isCsv ? XLSX.read(await file.text(), { type: 'string', raw: true }) : XLSX.read(await file.arrayBuffer(), { cellDates: true });
  const name = wb.SheetNames.find((n) => n.toLowerCase() === 'poster') || wb.SheetNames[0];
  return XLSX.utils.sheet_to_json(wb.Sheets[name], { defval: '', raw: !isCsv });
}

export function openImport() {
  let parsed = null;
  let el;
  const m = openModal({
    title: 'Importér fra Excel', wide: true, submitLabel: 'Importér',
    body: `<div id="imp-start">
        <ol class="steps-list">
          <li><b>Hent skabelonen</b> og åbn den i Excel. Arket "Vejledning" forklarer hver kolonne.<br><button type="button" class="btn ghost" id="imp-tpl">⬇ Hent skabelon (.xlsx)</button></li>
          <li><b>Udfyld</b> én række pr. indtægt, udgift eller overførsel. Slet eksemplerne først, og gem filen.</li>
          <li><b>Vælg filen her</b> (Excel eller CSV). Du ser en liste, før noget bliver gemt.<br><input type="file" id="imp-file" accept=".xlsx,.xls,.csv"></li>
        </ol>
      </div>
      <div id="imp-preview"></div>`,
    onOpen: (f) => {
      el = f;
      f.querySelector('[type=submit]').classList.add('hidden');
      f.querySelector('#imp-tpl').onclick = () => downloadTemplate().catch(errorToast);
      f.querySelector('#imp-file').onchange = async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        try {
          const L = lists();
          parsed = parseImportRows(await readFile(file), { accounts: L.accounts, people: L.people, categories: L.categories, existing: state.items, currentYm: currentYm() });
          draw();
        } catch (err) { errorToast(err); }
      };
    },
    onSubmit: async () => {
      const picked = parsed.rows.filter((r, i) => r.ok && el.querySelector(`[name=imp_${i}]`)?.checked);
      if (!picked.length) { toast('Vælg mindst én post', 'error'); return false; }
      const L = lists();
      const patch = {};
      for (const k of ['accounts', 'people', 'categories']) {
        const used = parsed.newValues[k].filter((v) => picked.some((r) => [r.item.account, r.item.toAccount, r.item.who, r.item.category].includes(v)));
        if (used.length) patch[`lists.${k}`] = [...L[k], ...used];
      }
      if (Object.keys(patch).length) await updateDoc(budgetRef(), { ...patch, updatedAt: serverTimestamp() });
      let done = 0;
      for (const r of picked) { await saveItem(null, { ...r.item, visibleTo: defaultVisibleTo() }); done++; }
      toast(`${done} ${done === 1 ? 'post' : 'poster'} importeret 🎉`, 'ok', 5000);
    },
  });
  function draw() {
    const ok = parsed.rows.filter((r) => r.ok), bad = parsed.rows.filter((r) => !r.ok);
    const nv = parsed.newValues;
    const news = [['accounts', 'konti'], ['people', 'personer'], ['categories', 'kategorier']].filter(([k]) => nv[k].length).map(([k, label]) => `${label}: ${nv[k].map(esc).join(', ')}`);
    el.querySelector('#imp-start').classList.add('hidden');
    el.querySelector('#imp-preview').innerHTML = !parsed.rows.length ? '<p class="hint warn">Der var ingen rækker i filen. Tjek at arket hedder "Poster", og at overskrifterne i første række er de samme som i skabelonen.</p>' : `
      <p><b>${ok.length}</b> ${ok.length === 1 ? 'post' : 'poster'} klar til import${bad.length ? ` · <span class="neg">${bad.length} med fejl (springes over)</span>` : ''}.</p>
      ${news.length ? `<p class="hint">Nyt, der oprettes i listerne — ${news.join(' · ')}</p>` : ''}
      <ul class="imp-list">${parsed.rows.map((r, i) => (r.ok ? `<li>
          <label class="check"><input type="checkbox" name="imp_${i}" ${r.dup ? '' : 'checked'}>
          <span class="imp-main"><b>${esc(r.item.name)}</b> <span class="chip">${TYPE_LABEL[r.item.type]}</span>${r.dup ? ' <span class="chip warn">findes allerede</span>' : ''}
            <small class="muted">${esc(freqLabel(r.item.freq, lists().frequencies))} · ${r.item.payDay >= 31 ? 'sidste dag' : `den ${r.item.payDay}.`} · ${esc(r.item.account || 'ingen konto')}${r.item.toAccount ? ` → ${esc(r.item.toAccount)}` : ''}${r.item.who ? ` · ${esc(r.item.who)}` : ''}${r.item.category ? ` · ${esc(r.item.category)}` : ''}</small>
            ${r.warnings.length ? `<small class="warn">⚠ ${r.warnings.map(esc).join(' · ')}</small>` : ''}</span>
          <span class="imp-amt">${kr(r.item.amount, false)}</span></label></li>`
        : `<li class="bad"><span class="imp-main"><b>Række ${r.line}${r.item.name ? `: ${esc(r.item.name)}` : ''}</b><small class="neg">✕ ${r.errors.map(esc).join(' · ')}</small></span></li>`)).join('')}</ul>
      <button type="button" class="link" id="imp-again">Vælg en anden fil</button>`;
    el.querySelector('[type=submit]').classList.toggle('hidden', !ok.length);
    el.querySelector('#imp-again')?.addEventListener('click', () => { el.querySelector('#imp-start').classList.remove('hidden'); el.querySelector('#imp-preview').innerHTML = ''; el.querySelector('#imp-file').value = ''; el.querySelector('[type=submit]').classList.add('hidden'); });
  }
  return m;
}
