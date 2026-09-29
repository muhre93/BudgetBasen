// Hjælp i hverdagssprog: små ?-knapper og en velkomstguide første gang.
import { openModal, lsGet, lsSet, esc } from './ui.js';

export const HELP = {
  in: ['Penge ind hver måned', 'Alt det, der kommer ind: løn, børnepenge osv. Kommer noget kun ind en gang om året, deles det ud på 12 måneder, så du kan sammenligne.'],
  out: ['Penge ud hver måned', 'Alle faste regninger omregnet til et månedsbeløb. En forsikring på 1.200 kr. om året tæller som 100 kr. om måneden.'],
  left: ['Tilbage hver måned', 'Penge ind minus penge ud. Er tallet grønt, er der penge tilovers. Er det rødt, bruger I flere penge end der kommer ind.'],
  year: ['Hele året', '"Tilbage hver måned" gange 12. Tallet nedenunder er det, der faktisk bliver betalt i år, fordi nogle regninger ikke falder hver måned.'],
  persons: ['Hvem betaler hvad', 'Viser hvor mange penge hver person skal af med om måneden: deres egne regninger + deres del af det, der skal ind på fælleskontoen. Poster der trækkes fra en fælleskonto tæller som fælles. Andre poster fordeles efter den procent, der står på posten.'],
  budgetkonto: ['Kontosaldo', 'Skriv hvad der står på kontoen i netbanken. Appen regner ud, hvor meget der BØR stå, så der er penge nok til de regninger, der kommer senere. Eksempel: en årlig forsikring på 1.200 kr. — efter 6 måneder bør der være sparet 600 kr. op.'],
  cashflow: ['Likviditet', 'Likviditet betyder: er der penge nok på kontoen på det tidspunkt, regningerne skal betales? Appen gennemgår hver eneste betaling dag for dag, så du kan se om kontoen går i minus, fx den 1. før lønnen kommer den 25.'],
  split: ['Fordeling', 'Hvis I deler en regning, kan du skrive hvor mange procent hver betaler. Trækkes posten fra en fælleskonto, behøver du ikke — så er den automatisk fælles.'],
  visible: ['Hvem må se den?', '"Alle i budgettet" betyder at alle medlemmer kan se den. Vælger du bestemte personer, kan de andre slet ikke se den — heller ikke admin. Godt til gaver eller til at skjule voksenposter for børnene.'],
  freq: ['Hvor ofte', 'Hvor tit regningen betales. Appen regner selv ud, hvad det svarer til om måneden.'],
  export: ['Hent / del', 'PDF er en færdig side, du kan printe eller sende til banken. Excel er et regneark, hvis du selv vil regne videre på tallene.'],
};

export const helpBtn = (key) => `<button type="button" class="help-btn" data-help="${key}" aria-label="Hvad betyder det?">?</button>`;

// Én global lytter for alle ?-knapper
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-help]');
  if (!b) return;
  e.preventDefault(); e.stopPropagation();
  const [title, text] = HELP[b.dataset.help] || ['Hjælp', ''];
  openModal({ title, body: `<p class="help-text">${esc(text)}</p>` });
}, true);

const STEPS = [
  ['👋 Velkommen til BudgetBasen', 'Her samler I alt om familiens økonomi: faste regninger, indtægter, kvitteringer og kontrakter. Du kan ikke ødelægge noget — alt kan rettes igen.'],
  ['📋 Budget', 'Tryk på den grønne knap for at tilføje en indtægt (fx løn) og den blå for en udgift (fx husleje). Skriv beløbet som det står på regningen — appen regner selv ud, hvad det koster om måneden.'],
  ['💰 Likviditet', 'Viser måned for måned om der er penge nok på kontoen, når regningerne skal betales. Grøn = fint, gul = stramt, rød = der mangler penge.'],
  ['🧾 Kvitteringer & dokumenter', 'Tag et billede af en kvittering med telefonen, så er den gemt. Forsikringer og kontrakter gemmes for sig under Dokumenter.'],
  ['❓ Små spørgsmålstegn', 'Er du i tvivl om hvad et tal betyder, så tryk på det lille ? ved siden af. Så forklarer appen det.'],
];
export function showWelcome() {
  let i = 0;
  const m = openModal({
    title: STEPS[0][0], body: `<p class="help-text" id="wel-txt">${esc(STEPS[0][1])}</p><div class="dots" id="wel-dots"></div>`,
    submitLabel: 'Næste',
    onOpen: (f) => { f.querySelector('#wel-dots').innerHTML = STEPS.map((_, k) => `<i class="${k === 0 ? 'on' : ''}"></i>`).join(''); },
    onSubmit: (fd, form) => {
      i++;
      if (i >= STEPS.length) return true;
      form.querySelector('.modal-head h2').textContent = STEPS[i][0];
      form.querySelector('#wel-txt').textContent = STEPS[i][1];
      form.querySelectorAll('#wel-dots i').forEach((d, k) => d.classList.toggle('on', k === i));
      if (i === STEPS.length - 1) form.querySelector('[type=submit]').textContent = 'Kom i gang';
      return false;
    },
    onClose: () => lsSet('bb:welcomed', true),
  });
  return m;
}
export function maybeShowWelcome() {
  if (lsGet('bb:welcomed', false)) return;
  lsSet('bb:welcomed', true);
  setTimeout(showWelcome, 400);
}
