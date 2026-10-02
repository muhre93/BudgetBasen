// Hjælp i hverdagssprog: små ?-knapper og en velkomstguide første gang.
import { openModal, lsGet, lsSet, esc } from './ui.js';
import { getConfig, feature } from './config.js';

export const HELP = {
  in: ['Indtægter hver måned', 'Alt det, der kommer ind: løn, børnepenge osv. Kommer noget kun ind en gang om året, deles det ud på 12 måneder, så du kan sammenligne.'],
  out: ['Udgifter hver måned', 'Alle faste regninger omregnet til et månedsbeløb. En forsikring på 1.200 kr. om året tæller som 100 kr. om måneden.'],
  left: ['Reelt til forbrug', 'Det I reelt har til forbrug hver måned, når alle regninger og al opsparing er dækket. Overfører I for lidt til fx budgetkontoen, står der flere penge på lønkontoen — men de skal bruges til regningerne, så de tæller ikke med her. Det står i linjen under tallet. Overfører I for meget, samler det ekstra sig på budgetkontoen og tæller heller ikke med.'],
  saving: ['Opsparing', 'Faste overførsler til en opsparingskonto. De trækkes fra "Tilbage af lønnen", fordi pengene er lagt til side. Hvilke konti der er opsparing, vælger du under Admin → Lister.'],
  accountView: ['Vis hele budgettet eller én konto', '"Hele budgettet" viser alt: indtægter, udgifter og opsparing. Vælger du en konto, fx Budgetkonto, ser du kun det, der går ind og ud af netop den konto — inkl. overførsler til og fra den. Opsparing der går fra en anden konto, tæller ikke med her.'],
  acctIn: ['Kommer ind på kontoen', 'Alt det, der sættes ind på kontoen hver måned: løn der går direkte hertil, og overførsler fra jeres andre konti.'],
  acctOut: ['Går ud fra kontoen', 'Alle regninger der trækkes fra kontoen, plus overførsler fra kontoen til jeres andre konti (fx opsparing).'],
  acctLeft: ['Tilbage på kontoen', 'Det der kommer ind minus det der går ud. Står der 0 eller lidt over, passer overførslen præcis til regningerne. Står der minus, skal der overføres mere til kontoen.'],
  year: ['Hele året', '"Tilbage hver måned" gange 12. Tallet nedenunder er det, der faktisk bliver betalt i år, fordi nogle regninger ikke falder hver måned.'],
  persons: ['Hvem betaler hvad', 'Viser hvor mange penge hver person skal af med om måneden: deres egne regninger + deres del af det, der skal ind på fælleskontoen. Poster der trækkes fra en fælleskonto tæller som fælles. Andre poster fordeles efter den procent, der står på posten.'],
  budgetkonto: ['Hvad står der på kontoen?', 'Skriv hvad der står på kontoen i netbanken. Appen gennemgår så alle kommende regninger og overførsler et år frem, dag for dag. "Du kan bruge" er det beløb, du kan tage ud i dag, uden at kontoen på noget tidspunkt mangler penge til en regning. Står der 0 kr., er alt på kontoen reserveret til regninger, der kommer.'],
  cashflow: ['Likviditet', 'Likviditet betyder: er der penge nok på kontoen på det tidspunkt, regningerne skal betales? Appen gennemgår hver eneste betaling dag for dag, så du kan se om kontoen går i minus, fx den 1. før lønnen kommer den 25.'],
  split: ['Fordeling', 'Hvis I deler en regning, kan du skrive hvor mange procent hver betaler. Trækkes posten fra en fælleskonto, behøver du ikke — så er den automatisk fælles.'],
  visible: ['Hvem må se den?', '"Alle i budgettet" betyder at alle medlemmer kan se den. Vælger du bestemte personer, kan de andre slet ikke se den — heller ikke admin. Godt til gaver eller til at skjule voksenposter for børnene.'],
  freq: ['Hvor ofte', 'Hvor tit regningen betales. Appen regner selv ud, hvad det svarer til om måneden.'],
  bank: ['Bank', 'Her kan saldo og posteringer hentes direkte fra banken gennem Enable Banking, som er godkendt til det. Appen kan kun læse — den kan aldrig flytte penge. Du vælger selv, hvilke konti der kommer med i budgettet, og hvem der må se dem. Kobler du og din partner den samme konto på, genkender appen den som fælles.'],
  bankPlan: ['Plan og virkelighed', 'Appen sammenligner budgettets poster med det, der faktisk er trukket eller kommet ind på kontoen. ✅ betyder trukket som planlagt, ⚠️ at beløbet var anderledes, ❌ at den ikke er fundet i banken, og 🕒 at den kommer senere i måneden. Faste betalinger, der går igen hver måned uden at stå i budgettet, foreslås nederst.'],
  bankSpend: ['Forbrug pr. kategori', 'Alle udgifter fra jeres bankkonti sorteret i kategorier, fx Dagligvarer og Transport. Overførsler mellem jeres egne konti tæller ikke med. Pilene viser, om I har brugt mere (↑) eller mindre (↓) end måneden før. Tryk på en kategori for at se posteringerne, og tryk på en postering for at flytte den til en anden kategori — så husker appen det.'],
  bankSubs: ['Faste træk', 'Betalinger, der går igen med samme beløb hver måned, hvert kvartal eller hvert år — fx streaming, forsikring og mobil. 📈 betyder, at prisen er steget siden sidst. Står der "✓ i budgettet", findes den allerede som post i budgettet.'],
  export: ['Hent / del', 'PDF er en færdig side, du kan printe eller sende til banken. Excel er et regneark, hvis du selv vil regne videre på tallene.'],
};

export const helpBtn = (key) => `<button type="button" class="help-btn" data-help="${key}" aria-label="Hvad betyder det?">?</button>`;

// ?-knappen må aldrig stå alene på en ny linje: det sidste ord før den
// "limes" sammen med knappen i en span, der ikke må brydes.
function glueHelp(root) {
  root.querySelectorAll?.('.help-btn:not([data-glued])').forEach((b) => {
    b.dataset.glued = '1';
    const prev = b.previousSibling;
    if (!prev || prev.nodeType !== 3) return;
    const m = prev.textContent.match(/(\S+)(\s*)$/);
    if (!m) return;
    prev.textContent = prev.textContent.slice(0, m.index);
    const span = document.createElement('span');
    span.className = 'nowrap';
    b.replaceWith(span);
    span.append(document.createTextNode(m[1] + ' '), b);
  });
}
new MutationObserver((muts) => {
  for (const mu of muts) mu.addedNodes.forEach((n) => { if (n.nodeType === 1) glueHelp(n.matches?.('.help-btn') ? n.parentNode : n); });
}).observe(document.documentElement, { childList: true, subtree: true });

// Én global lytter for alle ?-knapper
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-help]');
  if (!b) return;
  e.preventDefault(); e.stopPropagation();
  const custom = getConfig().texts?.help?.[b.dataset.help];
  const [title, text] = (Array.isArray(custom) && custom[1] ? custom : null) || HELP[b.dataset.help] || ['Hjælp', ''];
  openModal({ title, body: `<p class="help-text">${esc(text)}</p>` });
}, true);

const STEPS = [
  ['👋 Velkommen til BudgetBasen', 'Her samler I alt om familiens økonomi: faste regninger, indtægter, opsparing, kvitteringer og kontrakter. Du kan ikke ødelægge noget — alt kan rettes igen. Hvordan vil du starte?'],
  ['📋 Budget', 'Tryk på den grønne knap for at tilføje en indtægt (fx løn), den blå for en udgift (fx husleje) og "Overførsel" for fast opsparing eller penge der flyttes mellem jeres konti. Skriv beløbet som det står på regningen — appen regner selv ud, hvad det koster om måneden. Øverst kan du vælge at se hele budgettet eller én konto.'],
  ['💰 Likviditet', 'Viser måned for måned om der er penge nok på kontoen, når regningerne skal betales. Grøn = fint, gul = stramt, rød = der mangler penge.'],
  ['🧾 Kvitteringer & dokumenter', 'Tag et billede af en kvittering med telefonen, så er den gemt. Forsikringer og kontrakter gemmes for sig under Dokumenter.'],
  ['❓ Små spørgsmålstegn', 'Er du i tvivl om hvad et tal betyder, så tryk på det lille ? ved siden af. Så forklarer appen det.'],
];
let demoHandler = null;
export const setDemoHandler = (fn) => { demoHandler = fn; };

export function showWelcome() {
  let i = 0;
  const intro = getConfig().texts?.welcome || STEPS[0][1];
  const m = openModal({
    title: STEPS[0][0],
    body: `<p class="help-text" id="wel-txt">${esc(intro)}</p>
      <div class="welcome-choice ${feature('demo') ? '' : 'hidden'}" id="wel-choice">
        <button type="button" class="exp-opt" data-wel="demo"><span class="exp-ico">📚</span><span><b>Vis mig et prøvebudget</b><small>Se en opdigtet familie med løn, regninger, opsparing og kvitteringer. Dit eget budget bliver ikke rørt.</small></span></button>
        <button type="button" class="exp-opt" data-wel="own"><span class="exp-ico">✍️</span><span><b>Jeg starter med mit eget</b><small>Gå igennem en kort rundvisning og start med et tomt budget.</small></span></button>
      </div>
      <div class="dots" id="wel-dots"></div>`,
    submitLabel: 'Næste',
    onOpen: (f) => {
      f.querySelector('#wel-dots').innerHTML = STEPS.map((_, k) => `<i class="${k === 0 ? 'on' : ''}"></i>`).join('');
      f.querySelector('[data-wel=demo]').onclick = () => { m.close(); demoHandler?.(); setTimeout(() => showTour(), 900); };
      f.querySelector('[data-wel=own]').onclick = () => f.requestSubmit();
    },
    onSubmit: (fd, form) => {
      i++;
      if (i >= STEPS.length) return true;
      form.querySelector('#wel-choice')?.remove();
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

/** Kort rundvisning i prøvebudgettet. */
const TOUR = [
  ['🏠 Hele budgettet', 'Øverst ser du Anna og Jonas’ samlede økonomi: indtægter, udgifter, opsparing og hvad der er tilbage af lønnen. Tryk på et lille ? for at få et tal forklaret.'],
  ['💳 Én konto ad gangen', 'Tryk på "Budgetkonto" i rækken øverst. Så ser du kun det, der går ind og ud af budgetkontoen — opsparingen blander sig ikke.'],
  ['📝 Prøv at rette noget', 'Tryk på "Realkredit" og skift beløbet. Læg mærke til "Før:" under feltet, og at alle tal opdateres med det samme.'],
  ['💰 Likviditet', 'Under Likviditet kan du se måned for måned, om der er penge nok på kontoen. Grøn = fint, gul = stramt, rød = mangler penge.'],
  ['↺ Når du er færdig', 'Den gule bjælke øverst lader dig nulstille eksemplet eller slette det. Dit eget budget finder du i vælgeren øverst.'],
];
function showTour() {
  let i = 0;
  openModal({
    title: TOUR[0][0], body: `<p class="help-text" id="tour-txt">${esc(TOUR[0][1])}</p><div class="dots">${TOUR.map((_, k) => `<i class="${k === 0 ? 'on' : ''}"></i>`).join('')}</div>`,
    submitLabel: 'Næste',
    onSubmit: (fd, form) => {
      i++;
      if (i >= TOUR.length) return true;
      form.querySelector('.modal-head h2').textContent = TOUR[i][0];
      form.querySelector('#tour-txt').textContent = TOUR[i][1];
      form.querySelectorAll('.dots i').forEach((d, k) => d.classList.toggle('on', k === i));
      if (i === TOUR.length - 1) form.querySelector('[type=submit]').textContent = 'Luk';
      return false;
    },
  });
}
export { showTour };
export function maybeShowWelcome() {
  if (lsGet('bb:welcomed', false)) return;
  lsSet('bb:welcomed', true);
  setTimeout(showWelcome, 400);
}
