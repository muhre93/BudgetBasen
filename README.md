# BudgetBasen

Familiens budget, likviditet, kvitteringer og kontrakter — én PWA på GitHub Pages med Firebase (login + database) og en Cloudflare Worker til filer. **Alt kører på gratis planer uden betalingskort.** Ingen build-step, ingen terminal: alt sættes op i browseren.

## Projektstruktur

```
budgetbasen/
├── index.html              App-skal: login, topbar, menu, containere
├── style.css               Hele designet (aurora + glas, mørkt/lyst tema, mobil først)
├── firebase-config.js      ← DEN ENESTE FIL DU SKAL RETTE
├── app.js                  Indgang: login, valg af budget, navigation, invitationer
├── manifest.json · sw.js   PWA: installérbar, hurtig opstart, offline
├── icons/                  App-ikoner (SVG + PNG)
├── firestore.rules         Sikkerhedsregler for databasen   → kopieres ind i Firebase Console
├── worker/
│   ├── budgetbasen-files.js  Cloudflare Worker: gemmer kvitteringer/kontrakter i Workers KV
│   └── wrangler.toml       Kun hvis Worker'en deployes fra GitHub
├── js/
│   ├── calc.js             ALLE beregninger (rene funktioner, testet)
│   ├── firebase.js         Firebase-initialisering (SDK-version ét sted)
│   ├── data.js             Al læsning/skrivning i Firestore + log
│   ├── files.js            Billedkomprimering + upload/åbn/slet via Worker'en
│   ├── export.js           PDF (jsPDF) og Excel (SheetJS) — hentes først ved klik
│   ├── forms.js            Dropdowns med "+ Tilføj ny…", synlighed og %-fordeling
│   ├── help.js             ?-forklaringer og velkomstguide
│   ├── demo.js             Prøvebudgettet (eksempel-familien)
│   ├── state.js            Fælles tilstand, roller, standardlister
│   ├── ui.js               Formatering (kr., datoer), modaler, toasts
│   └── views/
│       ├── budget.js       Nøgletal, kontosaldo, poster pr. kategori
│       ├── cashflow.js     Likviditet måned for måned + graf
│       ├── receipts.js     Kvitteringsscanner + søgning
│       ├── documents.js    Forsikringer, kontrakter, frister
│       ├── admin.js        Budgetter, medlemmer, lister, links, versioner, log, eksport
│       ├── share.js        Del/udskriv + offentlig read-only visning
│       └── compare.js      Sammenligning af versioner/budgetter
└── tests/                  27 beregnings-tests + 9 sikkerhedstests af Worker'en
```

---

## Opsætning trin for trin (ca. 20 min.)

> Tests: `node tests/calc.test.mjs`, `node tests/worker.test.mjs`, `node tests/bank.test.mjs`, `node tests/bankmatch.test.mjs`, `node tests/categorize.test.mjs`.

### 1. Opret Firebase-projekt
1. Gå til <https://console.firebase.google.com> → **Tilføj projekt** → giv det et navn (f.eks. `budgetbasen`). Google Analytics er ikke nødvendigt.
2. **Build → Authentication → Kom i gang → Sign-in method → Google → Aktivér** (vælg din e-mail som support-mail) → Gem.
3. **Build → Firestore Database → Opret database** → vælg lokation **eur3 (Europe)** → start i **production mode**.
4. **Projektindstillinger (⚙) → Generelt → Dine apps → `</>` (Web)** → registrér appen (ingen Hosting) → kopiér `firebaseConfig`-objektet.

### 2. Cloudflare Worker + KV til kvitteringer og kontrakter (gratis, intet kort)
Firebase Storage kræver i dag et betalingskort, så filerne gemmes i stedet i **Cloudflare Workers KV** på din gratis Cloudflare-konto. Firestore gemmer stadig alle oplysninger om kvitteringer/dokumenter (inkl. en lille miniature), mens selve billedet/PDF'en ligger i KV.

1. **Cloudflare-dashboard → Storage & Databases → KV → Create namespace** → navn: `budgetbasen-files`.
2. **Workers & Pages → Create → Create Worker** → navn: `budgetbasen-files` → **Deploy** → **Edit code** → slet eksempelkoden, indsæt hele `worker/budgetbasen-files.js` → **Deploy**.
3. Worker → **Settings → Bindings → Add → KV namespace** → *Variable name* `FILES`, *KV namespace* `budgetbasen-files` → Save.
4. Worker → **Settings → Variables and Secrets → Add** (type *Text*):
   - `FIREBASE_PROJECT_ID` = dit Firebase-projekt-id (står i `firebaseConfig.projectId`)
   - `ALLOWED_ORIGINS` = `https://muhre93.github.io,https://kronborg1980.github.io`
5. Kopiér Worker'ens adresse (f.eks. `https://budgetbasen-files.dit-navn.workers.dev`) og åbn den i browseren — `…/health` skal svare `{"ok":true,…}`.

Foretrækker du at deploye fra GitHub (som din pbm-worker), så læg mappen `worker/` i et repo, udfyld `wrangler.toml` og forbind det under *Workers Builds*.

**Gratis-grænser på Workers KV (Free-plan):** ca. 1 GB lager i alt, op til 25 MB pr. fil (appen tillader 10 MB) og 1.000 uploads/sletninger om dagen. Billeder komprimeres automatisk til typisk 200–400 KB, så der er plads til flere tusinde kvitteringer.

### 2b. Invitationsmails (EmailJS — gratis, intet kort, ca. 5 min.)
Mails sendes fra **din** Gmail, uanset hvem i familien der trykker "Invitér". De andre skal ikke sætte noget op. Gratis op til 200 mails/md.

1. Gå til <https://www.emailjs.com> → **Sign up** (log ind med Google).
2. **Email Services → Add New Service → Gmail → Connect Account** → vælg muhre93@gmail.com → **Create Service**. Notér **Service ID** (fx `service_abc123`).
3. **Email Templates → Create New Template**:
   - **Subject:** `{{inviter_name}} har inviteret dig til BudgetBasen`
   - **To Email:** `{{to_email}}` · **Reply To:** `{{reply_to}}` · **From Name:** `BudgetBasen`
   - **Content:**
     ```
     Hej!

     {{inviter_name}} har inviteret dig til budgettet "{{budget_name}}" i BudgetBasen som {{role_text}}.

     Sådan gør du:
     1. Åbn {{app_url}}
     2. Log ind med Google — brug den mail, som denne besked er sendt til.
     3. Tryk "Acceptér" øverst.

     Venlig hilsen
     {{inviter_name}}
     ```
   - **Save**. Notér **Template ID** (fx `template_xyz789`).
4. **Account → General**: kopiér **Public Key**. **Account → Security**: slå **"Allow EmailJS API for non-browser applications"** til, og kopiér **Private Key**.
5. Cloudflare → din Worker → **Settings → Variables and Secrets → Add**, type **Secret**, fire gange:
   `EMAILJS_SERVICE_ID`, `EMAILJS_TEMPLATE_ID`, `EMAILJS_PUBLIC_KEY`, `EMAILJS_PRIVATE_KEY` → **Deploy**.

Uden disse virker appen stadig — så står der "Egen mail" ved invitationen, som åbner din mail-app med en færdigskrevet besked.

### 3. Indsæt din konfiguration
Åbn `firebase-config.js` og erstat værdierne med dem fra trin 1.4, og indsæt Worker-adressen fra trin 2.5 i `FILES_WORKER_URL`. `apiKey` er ikke en hemmelighed — det er helt fint, at den ligger offentligt på GitHub. Sikkerheden ligger i reglerne (trin 5) og i Worker'ens adgangstjek.

### 4. Læg appen på GitHub Pages
1. Opret et nyt repository på github.com (f.eks. `BudgetBasen`).
2. **Add file → Upload files** → træk HELE indholdet af mappen ind (inkl. `js/` og `icons/`) → Commit.
3. **Settings → Pages → Source: Deploy from a branch → `main` / `(root)`** → Save. Efter et minut ligger appen på `https://kronborg1980.github.io/BudgetBasen/`.
4. Tilbage i Firebase: **Authentication → Settings → Authorized domains → Add domain → `kronborg1980.github.io`**. (Uden dette fejler Google-login.)

### 5. Sikkerhedsregler — så data holdes strengt adskilt

**Firestore:** *Build → Firestore Database → fanen **Regler*** → slet alt → indsæt hele indholdet af `firestore.rules` → **Udgiv**.

**Test reglerne** med *Rules Playground* (knappen over regel-editoren): simulér f.eks. en `get` på `/budgets/ET_ID` med en anden brugers UID — den skal blive **afvist**.

#### Sådan beskytter reglerne dine data
- **Alt ligger under ét budget:** `budgets/{id}` + underliggende `items`, `receipts`, `documents`, `snapshots`, `log`. Adgang afgøres *udelukkende* af budgettets `members`-map `{ uid: 'admin' | 'edit' | 'read' }`. Er du ikke i mappen, kan du hverken læse, liste eller skrive noget.
- **Nye brugere** kan kun oprette et budget, hvor de selv er ejer og eneste medlem → fremmede får automatisk et tomt, privat workspace og kan aldrig se dit.
- **Invitationer:** Du (admin) opretter `invites/{budgetId}_{email}`. Kun den person, der er logget ind med *præcis den verificerede Google-mail*, kan tilføje sig selv — og kun med den rolle, du har valgt. Kender man et budget-id, hjælper det ikke uden en invitation.
- **Roller:** *Kun læse* kan intet ændre. *Redaktør* kan ændre poster, kvitteringer, dokumenter og saldo — men ikke medlemmer, og kan ikke slette versioner. *Admin* kan alt, men **ejeren kan aldrig fjernes eller degraderes**, og ejerskab kan ikke overtages.
- **Loggen** kan ingen redigere eller slette (undtagen når ejeren sletter hele budgettet).
- **Delte links** (`shares/{token}`) kan læses af alle med det 28-tegns tilfældige link, men ingen kan *liste* eller søge i dem, og de udløber automatisk efter den valgte periode. Linket er et øjebliksbillede — det indeholder kun de poster, du satte flueben ved.
- **Private poster:** Hver post, kvittering og hvert dokument har "Hvem må se den?". Reglerne sender kun det, man må se — heller ikke admin eller ejer kan se andres private ting. Loggen viser private ting uden navn. Versioner (til sammenligning) indeholder kun delte poster.
- **Invitationsmails:** Worker'en sender kun mail for rigtige invitationer oprettet af en admin, og linket i mailen kan kun pege på jeres egne sider (ALLOWED_ORIGINS) — så den kan ikke misbruges til spam eller phishing.
- **Filer (Cloudflare Worker):** Worker'en har ingen hemmelige nøgler. Ved hver upload, visning og sletning sender appen brugerens Firebase-login-token med, og Worker'en slår budgettet op i Firestore *med det token* — så de samme Firestore-regler afgør adgangen. Læsere kan se filer, redaktører/admins kan uploade og slette, og kun ejeren kan slette alle filer på én gang. Ikke-medlemmer, udløbne logins, forkerte projekter, fremmede websites (CORS) og andre filtyper end billeder/PDF afvises. Der findes ingen offentlige fil-links.
- **Validering:** Budgetposter afvises, hvis type, beløb, frekvens eller betalingsdag er ugyldige.

### 6. Første login
Åbn appen → **Log ind med Google** → dit budget oprettes automatisk. Gå til **Admin → Medlemmer → Invitér**, skriv din kones Google-mail og vælg rolle. Når hun logger ind, dukker invitationen op øverst, og hun trykker *Acceptér*. Installér appen på telefonen (Safari: Del → *Føj til hjemmeskærm*; Chrome: *Installér app*), så åbner kameraet direkte fra *Kvitteringer*.

---

## Sådan regner appen (dobbelttjekket med 13 automatiske tests)

- **Beløb pr. post = beløb pr. betaling.** Frekvens = antal måneder mellem betalinger. **Pr. måned = beløb ÷ frekvens**, pr. år = pr. måned × 12. Eksempel: 1.200 kr. hver 3. måned = 400 kr./md. = 4.800 kr./år.
- **"Første/næste betaling"** (måned) + **betalingsdag** bestemmer præcis, i hvilke måneder og på hvilken dag pengene går. Dag 31 bliver automatisk til 30./28./29. i korte måneder.
- **Overskud pr. md.** = alle aktive indtægter − udgifter (normaliseret pr. måned). **Årets resultat** vises både normaliseret (×12) og som *faktiske* betalinger i kalenderåret.
- **Likviditet** simulerer saldoen betaling for betaling — ikke bare månedstotaler — så man ser hvis kontoen går i minus den 1., selvom lønnen kommer den 25. Beregnes i hele øre (ingen afrundingsfejl). Samme dag: indtægter før udgifter (som bankerne gør med faste overførsler og Betalingsservice). Betalinger med betalingsdag i dag eller tidligere i indeværende måned regnes som allerede trukket.
- **Budgetkonto "Bør stå":** for hver udgift på kontoen: beløb × (frekvens − måneder til næste betaling) ÷ frekvens. Forudsætter at den månedlige overførsel lander den 1. Eksempel: årlig forsikring på 1.200 kr. betalt i marts → i september bør der stå 600 kr. Appen viser overskud/manko og den anbefalede månedlige overførsel.

## Nyt i version 9
- **Importér fra Excel/CSV** (Budget → ⋯ Mere): hent skabelon, udfyld, upload, se listen igennem og gem. Fejl og dubletter markeres. `js/import.js`, `js/importparse.js`, `tests/import.test.mjs`.
- **"Reelt til forbrug"** er nu det store tal (når alle regninger er dækket). Overføres der for lidt til en konto, står der under tallet, hvad der står på lønkontoen og hvorfor.
- **Hovedkonto** (Admin → Budgetter): Budget-siden og simpel visning åbner på den. ⭐ i kontoknapperne.
- **Hvem betaler hvad:** Alle · person-knapper, et "Alle samlet"-kort, og vises også når man ser én konto. Ny indstilling **"Sådan deler vi"**: *hver betaler sine egne poster* (`settings.shareMode = 'own'`) eller *procent*. I "egne poster" vises pr. person: på hovedkontoen, overfører nu, og om det passer.
- **Bank:** tre faner (Oversigt · Forbrug inkl. faste træk · Posteringer). Konti og forbindelse ligger bag ⚙. Varsler og plan-rækker hopper til selve posteringen og markerer den. Planen viser først det, der ikke passer.
- **Opdatering:** kun upload af filer (Worker og regler er uændrede siden version 8).

## Nyt i version 8
- **Bank: fortegn rettet rigtigt.** Udgifter markeres af banken med `DBIT` (koden var skrevet forkert). Første hentning efter opdateringen henter alt igen. Ind = grønt med plus, ud = almindelig tekst med minus.
- **Bank-fanen:** kontovælger øverst (alle konti eller én) gælder alle under-faner · egne navne på bankkonti · kompakt kontoliste · alle kasser kan foldes sammen · varsler siger hvad det drejer sig om og hopper til posten · periode (fra–til + "Vis perioden") gælder både Forbrug og Posteringer.
- **Flere bankkonti på samme budgetkonto lægges sammen** i saldoen (`balances[].parts`).
- **Appen husker** valgt konto på Budget, under-fane, konto og periode i Bank samt hvad der er foldet sammen — også efter genindlæsning.
- **Budget-siden:** alle kasser har en pil og kan foldes sammen (erstatter ✕). "Tilføj" står for sig selv, "⋯ Mere" samler Hent/del, Sammenlign og Gem version, og Søg og filter er foldet sammen fra start.
- **"Hvem betaler hvad"** skjuler ikke længere sig selv.
- **Simpel visning:** vælg øverst mellem en konto (Budgetkonto som standard) og hele budgettet.
- **Opdatering:** ny Worker-kode + upload af alle filer. Ingen nye Firestore-regler.

## Nyt i version 7
- **"Tilbage af lønnen"** = løn minus alt, der faktisk trækkes eller overføres fra lønkontoen. Overføres der for lidt til fx Budgetkontoen, står pengene stadig på lønkontoen — og Budgetkontoens manko vises med rødt for sig (også på person-kortene: "Mangler at overføre").
- **Bank:** rettet fortegn for banker, der skriver minus foran beløbet i stedet for ind/ud-markering (fx Sparekassen Danmark). Kontoen selv regnes ikke længere som "mellem egne konti". Ud = rødt med minus, ind = grønt med plus. Første hentning efter opdateringen henter alt igen (op til 12 mdr.).
- **Bank-fanen har under-faner:** Oversigt (varsler, konti, plan og virkelighed) · Forbrug (kategorier + månedsopsummering) · Faste træk (abonnementer og prisstigninger) · Posteringer (fra–til, hurtigknapper, søgning, sum og antal, og hvor langt tilbage banken gav data).
- **Automatisk kategorisering** af posteringer. Retter man en kategori, huskes det for alle posteringer fra samme modtager (gemmes i `settings.txRules`).
- **Varsler:** lav saldo snart, regninger med andet beløb, betalinger der mangler, bankadgang der udløber, prisstigninger.
- **Faner:** Budget · Bank · Bilag (kvitteringer + dokumenter) · Likviditet · Admin.
- **Én "＋ Tilføj"-knap** med tre valg (fast knap nederst til højre på telefonen). Forklaring under hver gruppe.
- **⏸ Pause** fra–til på poster. **"Sidste dag i måneden"** som valg. **Bankdage** (weekend/helligdage) — kan slås fra under Admin → Budgetter.
- **✨/🧩-knap** øverst for simpel/udvidet visning, og et forslag om simpel visning første gang.
- **Skjul bokse** (gul/rød kontoboks, Hvem betaler hvad) for den enkelte — vis igen under Admin → Udseende. "Hvem betaler hvad" skjuler sig selv, når der kun er én person og intet fælles.
- **Konti uden poster** har en knap: "Tilføj fast overførsel hertil".
- **Opdatering:** ny Worker-kode + upload af alle filer. Ingen nye Firestore-regler (siden version 6).

## Nyt i version 6
- **🏦 Bank-fane (Enable Banking).** Saldo og posteringer hentes direkte fra banken. Kun læseadgang — appen kan aldrig flytte penge. Slås til pr. budget under Admin → Budgetter.
  - Hver bruger opretter sin **egen gratis** Enable Banking-app og indsætter App-ID + nøglefil (.pem) i appen (guide i appen). Nøglen gemmes **krypteret** i Workers KV med `BANK_SECRET` og sendes aldrig tilbage til telefonen.
  - **Plan og virkelighed:** budgetposter sammenlignes med posteringerne (✅ ⚠️ ❌ 🕒). Faste betalinger, der ikke står i budgettet, foreslås.
  - **Fælleskonti genkendes:** Worker'en laver en hemmelig fingeraftryks-kode (HMAC) af kontonummeret, så den samme konto får samme nøgle hos begge. Den anden bliver medejer.
  - Interne overførsler mellem jeres egne konti genkendes og tæller ikke som udgifter.
  - Banksaldoen bruges automatisk i "Du kan bruge …" og Likviditet.
  - Synlighed pr. konto: *Kun ejerne* eller *Alle voksne i budgettet*. Roller med "Kun læse" kan aldrig se bankdata (Firestore-regler).
- **👑 Ejer-admin** (kun muhre93@gmail.com): funktioner til/fra for alle, tekster og hjælpetekster, budgetsidens rækkefølge, besked til alle, brugeroversigt med bankstatus. Ligger i `config/app`.
- **Worker:** nye endpoints under `/bank/*`. Firebase-login tjekkes her med Googles offentlige nøgler (RS256). Ny secret `BANK_SECRET` (mindst 32 tegn — skift den aldrig) og valgfri variabel `OWNER_EMAIL`.
- **Nye filer:** `js/config.js`, `js/bank.js`, `js/bankmatch.js`, `js/views/bank.js`, `js/views/owner.js`, `tests/bank.test.mjs`, `tests/bankmatch.test.mjs`.
- **Husk:** upload nye Firestore-regler og ny Worker-kode.

## Nyt i version 5
- **"Tilbage af lønnen"** trækker nu også det, der overføres *for meget* til fx Budgetkontoen, fra. Det, der er tilbage, er det, man faktisk kan bruge. Det ekstra vises i en linje for sig.
- **En statuslinje for hver konto, der modtager overførsler:** 🟢 passer / 🟡 X kr. for meget / 🔴 mangler X kr.
- **Kontosaldo:** "Du kan bruge X kr." (uden at mangle til regningerne det næste år), "Der mangler X den D" og næste store regning.
- **Formularen** er delt i grupper (Hvad og hvor meget / Hvornår / Konto og hvem / Mere) og viser "📅 Næste gang: …". Felter, der ikke giver mening, er fjernet. Kategorien for overførsler sættes automatisk.
- **Udseende:** 3 lyse og 2 mørke temaer (Admin → Udseende) og en dag/nat-knap øverst. Valget gemmes pr. person.
- **Simpel visning** pr. person: tre store tal, en enkel liste og "Tilføj", der stiller ét spørgsmål ad gangen.
- **"Fælles" kan slås fra** under Hvem betaler hvad (hvis man er alene eller ikke har en fælleskonto).
- Opsparingskonti vises med 💵. ?-knapper står aldrig alene på en linje. Gennemtjekket på telefoner fra 360 px.
- Upload alle filer igen. Der er ingen ændringer i Firestore-regler eller Worker.

## Nyt i version 4
- **Indtægt / Udgift / Overførsel.** Overførsler flytter penge mellem jeres egne konti (fx fast opsparing eller Lønkonto → Budgetkonto).
- **Opsparing trækkes fra i det samlede budget:** Indtægter − Udgifter − Opsparing = **Tilbage af lønnen**. Hvilke konti der er opsparing, vælges under Admin → Lister.
- **Vis hele budgettet eller én konto** (knapperne øverst på Budget). På en enkelt konto ser du kun det, der går ind og ud af netop den — inkl. overførsler. Opsparing fra en anden konto rører den ikke.
- **Likviditet** tæller overførsler med, når du ser på én konto. Knappen "Tilføj månedlig overførsel" laver nu en rigtig overførsel.
- **Prøvebudget:** en opdigtet familie (Anna & Jonas) med løn, regninger, opsparing, kvitteringer, et dokument med opsigelsesfrist og en gammel version at sammenligne med. Tilbydes ved første login; kan altid laves under Admin → Budgetter. Gul bjælke med *Nulstil* og *Slet*.
- 27 beregnings-tests (bl.a. opsparing pr. konto og samlet).

**Opdatering fra en tidligere version:** følg guiden "BudgetBasen opdatering" trin for trin. Kort: sæt den nye `firestore.rules` ind (ellers kan overførsler ikke gemmes), upload alle filer til GitHub, genindlæs appen.

## Nyt i version 3
- **Hvem betaler hvad:** kort pr. person med "skal af med i alt", egne regninger + andel til fælleskontoen, indtægter og hvad der er tilbage. Procent-fordeling pr. post; poster på en fælleskonto er automatisk fælles. Fordelingen af det fælleskontoen mangler, og hvilke konti der er fælles, rettes med "Ret fordeling".
- **Privat / synlighed:** "Hvem må se den?" (Alle / Kun mig / Udvalgte) på poster, kvitteringer og dokumenter + standard for nye poster (fx kun de voksne). "🔒 Nyt privat budget" til egen opsparing.
- **Filter-knap** på Budget og Kvitteringer; søgning sker for hvert bogstav uden at tastaturet lukker.
- **Historik:** når du retter en post, står "Før: …" ved feltet, og hver post har sin egen historik. Sammenligning viser hele budgettet side om side (før | nu | forskel) med en sætning i hverdagssprog.
- **Invitationer** sendes automatisk på mail og viser *Afventer* → *Godkendt ✓*.
- **Likviditet** i hverdagssprog: trafiklys, månedskort, forslag om at tilføje den månedlige overførsel, justerbar gul grænse.
- **Hent / del**: én knap med forklaring af PDF og Excel.
- **?-knapper** og velkomstguide; kvitteringer har egne lister (butikker, kategorier); bedre mobil-layout.

**Opdatering fra version 2:** upload alle filer til GitHub igen, sæt de nye `firestore.rules` ind og udgiv dem, og indsæt den nye Worker-kode i Cloudflare. Firestore-regler og Worker skal opdateres, ellers kan appen ikke se posterne.

## Ekstra funktioner, jeg har tilføjet
- **Budgetkonto-tjek** ("Bør stå / Overskud / Mangler") pr. konto — den klassiske danske budgetkonto-beregning.
- **Laveste punkt** og **første dag i minus** med konkret forslag til hvor meget der mangler.
- **Automatisk månedlig version** af budgettet, så *Sammenlign* altid har noget at sammenligne med (+ manuel "Gem version", og sammenligning med andre budgetter).
- **Omdøbning af listeværdier opdaterer alle poster** (f.eks. hvis "Tryg" bliver til "Tryg Forsikring").
- **Opsigelsesfrister på dokumenter**: udløbsdato + opsigelsesvarsel → advarsel 60 dage før fristen. Dokumenter kan kobles til budgetposten.
- **Garanti/returret-dato på kvitteringer**, miniaturebilleder og automatisk billedkomprimering (sparer plads og mobildata).
- **Privat-flueben pr. post**, så f.eks. gaver skjules som standard ved deling med banken.
- **PDF og Excel overalt hvor det giver mening:**
  - *Budget → Del / eksportér*: bank-rapport med de poster du har sat flueben ved (PDF, Excel eller print), valgfrit med 12 måneders likviditet.
  - *Likviditet*: måned for måned + alle betalinger med saldo efter hver.
  - *Kvitteringer*: præcis det aktuelle søgeresultat, PDF med miniaturebilleder og sum.
  - *Dokumenter*: oversigt med udløb, opsigelsesfrister og årlig pris.
  - *Admin → Eksport*: fuld backup i én Excel-fil (ark for poster, kvitteringer, dokumenter, saldi og lister).
  - Den offentlige bank-visning har også PDF/Excel-knapper.
  Excel-filerne har rigtige kr.-talformater, datoer, filtre og SUM-formler.
- **Kopiér post / kopiér budget** og teknisk JSON-backup.
- **Read-only links med udløbsdato**.
- **Offline**: appen åbner uden net, og ændringer synkroniseres, når der er forbindelse igen.

## Opdateringer
Når du ændrer filer, så hæv `VERSION` i `sw.js` (nu `bb-v4`, næste gang `bb-v5`), så installerede telefoner henter den nye udgave.
