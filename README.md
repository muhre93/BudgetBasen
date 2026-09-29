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
│   ├── forms.js            Dropdowns med "+ Tilføj ny…"
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
└── tests/                  13 beregnings-tests + 8 sikkerhedstests af Worker'en
```

---

## Opsætning trin for trin (ca. 20 min.)

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
   - `ALLOWED_ORIGINS` = `https://kronborg1980.github.io`
5. Kopiér Worker'ens adresse (f.eks. `https://budgetbasen-files.dit-navn.workers.dev`) og åbn den i browseren — `…/health` skal svare `{"ok":true,…}`.

Foretrækker du at deploye fra GitHub (som din pbm-worker), så læg mappen `worker/` i et repo, udfyld `wrangler.toml` og forbind det under *Workers Builds*.

**Gratis-grænser på Workers KV (Free-plan):** ca. 1 GB lager i alt, op til 25 MB pr. fil (appen tillader 10 MB) og 1.000 uploads/sletninger om dagen. Billeder komprimeres automatisk til typisk 200–400 KB, så der er plads til flere tusinde kvitteringer.

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
- **Filer (Cloudflare Worker):** Worker'en har ingen hemmelige nøgler. Ved hver upload, visning og sletning sender appen brugerens Firebase-login-token med, og Worker'en slår budgettet op i Firestore *med det token* — så de samme Firestore-regler afgør adgangen. Læsere kan se filer, redaktører/admins kan uploade og slette, og kun ejeren kan slette alle filer på én gang. Ikke-medlemmer, udløbne logins, forkerte projekter, fremmede websites (CORS) og andre filtyper end billeder/PDF afvises. Der findes ingen offentlige fil-links.
- **Validering:** Budgetposter afvises, hvis type, beløb, frekvens eller betalingsdag er ugyldige.

### 6. Første login
Åbn appen → **Log ind med Google** → dit budget oprettes automatisk. Gå til **Admin → Medlemmer → Invitér**, skriv din kones Google-mail og vælg rolle. Når hun logger ind, dukker invitationen op øverst, og hun trykker *Acceptér*. Installér appen på telefonen (Safari: Del → *Føj til hjemmeskærm*; Chrome: *Installér app*), så åbner kameraet direkte fra *Kvitteringer*.

---

## Sådan regner appen (dobbelttjekket med 13 automatiske tests)

- **Beløb pr. post = beløb pr. betaling.** Frekvens = antal måneder mellem betalinger. **Pr. måned = beløb ÷ frekvens**, pr. år = pr. måned × 12. Eksempel: 1.200 kr. hver 3. måned = 400 kr./md. = 4.800 kr./år.
- **"Første/næste betaling"** (måned) + **betalingsdag** bestemmer præcis, i hvilke måneder og på hvilken dag pengene går. Dag 31 bliver automatisk til 30./28./29. i korte måneder.
- **Overskud pr. md.** = alle aktive indtægter − udgifter (normaliseret pr. måned). **Årets resultat** vises både normaliseret (×12) og som *faktiske* betalinger i kalenderåret.
- **Likviditet** simulerer saldoen betaling for betaling — ikke bare månedstotaler — så man ser hvis kontoen går i minus den 1., selvom lønnen kommer den 25. Beregnes i hele øre (ingen afrundingsfejl). Samme dag: udgifter trækkes før indtægter (forsigtigt). Betalinger med betalingsdag i dag eller tidligere i indeværende måned regnes som allerede trukket.
- **Budgetkonto "Bør stå":** for hver udgift på kontoen: beløb × (frekvens − måneder til næste betaling) ÷ frekvens. Forudsætter at den månedlige overførsel lander den 1. Eksempel: årlig forsikring på 1.200 kr. betalt i marts → i september bør der stå 600 kr. Appen viser overskud/manko og den anbefalede månedlige overførsel.

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
Når du ændrer filer, så hæv `VERSION` i `sw.js` (f.eks. `bb-v3`), så installerede telefoner henter den nye udgave.
