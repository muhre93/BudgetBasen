# BudgetBasen — overdragelse (version 9)

**Læs hele denne fil, før du ændrer noget.** Den fortæller, hvordan du skal arbejde med ejeren, hvad der er besluttet, hvad der mangler, og hvad der ikke er afprøvet. `README.md` har opsætningen og en liste over ændringerne i hver version.

Ejeren hedder Lasse. Han er ikke programmør. Han uploader filer i hånden og tester selv i appen. Skriv til ham på dansk, i hverdagssprog.

---

## 1. Regler for dig, der bygger videre

Disse regler er de vigtigste i filen.

1. **Ændr kun det, der bliver bedt om.** Lav ikke om på navne, farver, layout, tekster, rækkefølge eller filstruktur, medmindre Lasse beder om det. Ryd ikke op "i samme omgang".
2. **Byg ikke noget, når han kun spørger.** Skriver han "vi snakker bare", "kun spg", "stadig spg" eller lignende, skal du kun svare. Byg først, når han siger "gå i gang", "du må gerne lave det" eller lignende.
3. **Foreslå, før du laver noget stort om.** Har du en bedre idé, så forklar den kort og vent på svar. Han har flere gange sagt nej til forslag, og det skal respekteres (se afsnit 3).
4. **Fjern aldrig en funktion uden at spørge.** Heller ikke hvis den virker overflødig.
5. **Behold stilen.** Ingen build-step, ingen frameworks, ingen nye biblioteker uden at spørge. Vanilla JavaScript-moduler, én `style.css`, tekster på dansk.
6. **Sig præcist, hvad du har ændret**, punkt for punkt, når du er færdig. Sig også, hvad du ikke har kunnet teste.
7. **Kør testene, før du afleverer:**
   `node tests/calc.test.mjs`, `worker.test.mjs`, `bank.test.mjs`, `bankmatch.test.mjs`, `categorize.test.mjs`, `import.test.mjs`. Alle skal bestå. Ændrer du en beregning, så tilføj en test.
8. **Tjek telefonbredde (360 og 390 px).** Ingen side må være bredere end skærmen. Det meste bruges på telefon.
9. **Hæv `VERSION` i `sw.js`** (nu `bb-v9`), hver gang filer ændres, og tilføj nye filer til `SHELL`-listen. Ellers ser telefonerne den gamle udgave.
10. **Aflever som én zip-fil** med hele mappen, og fortæl hvilke af de tre steder der skal opdateres: GitHub (filer), Cloudflare (Worker-kode), Firebase (regler). Sig tydeligt, hvis kun ét af dem er nødvendigt.
11. **Rør ikke ved `firebase-config.js`.** Den er udfyldt med hans rigtige oplysninger.

---

## 2. Hvad appen er

Et familiebudget som web-app (PWA) til Lasse og hans kone. Målet er, at den skal kunne forstås af folk, der ikke er gode med tal.

- **Hosting:** GitHub Pages. Filerne uploades i hånden via "Add file → Upload files".
- **Login og data:** Firebase Auth (Google) og Firestore, projekt `budgetbasen`.
- **Filer, mails og bank:** én Cloudflare Worker, `worker/budgetbasen-files.js`, på `https://budgetbasen-files.muhre93.workers.dev`. Koden sættes ind i Cloudflares editor i hånden. Workers KV-binding hedder `FILES`.
- **Intet betalingskort nogen steder.** Alt skal kunne køre på gratis-planerne.
- **Ejer-konto:** `muhre93@gmail.com`. Kun den konto kan åbne Ejer-admin (styres i Firestore-reglerne og i `js/config.js`).

### Filerne

| Fil | Indhold |
|---|---|
| `app.js` | Login, valg af budget, faner, besked til alle |
| `js/calc.js` | Alle beregninger. Rene funktioner, testet |
| `js/state.js` | Fælles tilstand, roller, lister, hovedkonto, delemåde |
| `js/data.js` | Læs og skriv i Firestore, log, invitationer |
| `js/views/budget.js` | Budget-siden, formularen til poster, Hvem betaler hvad |
| `js/views/simple.js` | Simpel visning og trin-for-trin "Tilføj" |
| `js/views/cashflow.js` | Likviditet |
| `js/views/bank.js`, `js/bank.js` | Bank-fanen og bankdata |
| `js/bankmatch.js`, `js/categorize.js` | Plan og virkelighed, kategorier, faste træk |
| `js/import.js`, `js/importparse.js` | Import fra Excel/CSV |
| `js/views/bilag.js`, `receipts.js`, `documents.js` | Kvitteringer og dokumenter |
| `js/views/admin.js` | Admin for det enkelte budget |
| `js/views/owner.js`, `js/config.js` | Ejer-admin (gælder alle brugere) |
| `js/prefs.js` | Tema, dag/nat, simpel visning pr. person |
| `firestore.rules` | Sikkerhedsregler |
| `worker/budgetbasen-files.js` | Worker: filer, invitationsmail, bank |

### Cloudflare-indstillinger

- Text: `FIREBASE_PROJECT_ID=budgetbasen`, `ALLOWED_ORIGINS=https://muhre93.github.io,https://kronborg1980.github.io`, `OWNER_EMAIL=muhre93@gmail.com`
- Secrets: `EMAILJS_SERVICE_ID`, `EMAILJS_TEMPLATE_ID`, `EMAILJS_PUBLIC_KEY`, `EMAILJS_PRIVATE_KEY`, `BANK_SECRET`
- **`BANK_SECRET` må aldrig ændres.** Den låser alle gemte bank-nøgler. Ændres den, skal alle sætte deres nøgle ind igen.

---

## 3. Lasses valg — lav dem ikke om

**Budget-siden**
- De **fire bokse** øverst skal blive (De store tal, Passer overførslerne, Hvem betaler hvad, Hvad står der på kontoen). Han har sagt nej til at samle dem i ét kort.
- Alle bokse har en **pil og kan foldes sammen**. Appen husker det. Pilen har erstattet ✕-knapper.
- **"Tilføj"** står for sig selv. Sammenlign, Gem version, Hent/del og Importér ligger under "⋯ Mere".
- **Søg og filter** er foldet sammen fra start.
- **Budgetkontoen er hovedkontoen ⭐.** Budget-siden og simpel visning åbner på den. Det er den, det hele handler om.
- Overskriften hedder **"Opsparing og overførsler"** (ikke "&").
- Opsparingskonti vises med **💵** (ikke en gris).

**Tallene**
- Det store tal hedder **"Reelt til forbrug"**: det, der er tilbage, når alle regninger og al opsparing er dækket.
- Overføres der for lidt til en konto, står der under tallet, hvad der står på lønkontoen, og hvilken konto der mangler penge.
- **Saldoen på en konto skal altid kunne ses**, som den er. Den må ikke skjules bag "afsat til regninger".
- Beløb pr. post er beløbet **hver gang** det betales. Appen regner selv om til pr. måned.

**Hvem betaler hvad**
- Lasse og hans kone er fælles om udgifterne, men **deler ikke i procent**. Den ene betaler fx al mad, den anden bilen. Derfor findes "Hver betaler sine egne poster" under "⚙ Sådan deler vi".
- Det skal være muligt at **slå Fælles fra**.
- Boksen må **ikke skjule sig selv**. Den vises altid, også når man ser én konto.
- Knapperne **Alle · person · person** skal blive. "Alle" viser det samlede.

**Bank**
- Kun læseadgang. Appen må aldrig kunne flytte penge.
- **Grønt med plus** er penge ind. **Almindelig tekst med minus** er penge ud. Sådan ser hans netbank ud.
- **Tre faner:** Oversigt · Forbrug · Posteringer. Konti og forbindelse ligger bag ⚙.
- Varsler skal sige, hvad det drejer sig om, og **hoppe til selve posteringen**.
- Bankdata er private som udgangspunkt. Roller med "Kun læse" (børn) må aldrig se bankdata.
- Det budget, man selv har sat op, er **planen**. Bankdata ligger ved siden af og blandes ikke ind af sig selv.

**Udseende**
- Lasse er glad for udseendet. Lav det ikke om.
- 3 lyse og 2 mørke temaer, dag/nat-knap og ✨-knap til simpel visning øverst.
- **?-knapper** må aldrig stå alene på en linje.
- Fanerne er: **Budget · Bank · Bilag · Likviditet · Admin**.

**Fravalgt med vilje**
- Et billede af pengestrømmen mellem konti.
- Et samlet kort i stedet for de fire bokse.
- Kvitteringer fra butikker, tilbud på dagligvarer, elpriser og en "score" som i Bliss.
- Frit layout i Ejer-admin.

---

## 4. Det, der mangler

**Aftalt, men ikke bygget: beskeder på telefonen (push)**
Lasse vil have besked, når en fast regning er dyrere end normalt, eller en konto er på vej i minus. Planen var:
- Worker'en tjekker banken én gang om dagen (Cloudflare cron) og sender Web Push.
- Appen lægger en lille krypteret "hold øje med"-liste hos Worker'en, hver gang den åbnes, fordi Worker'en ikke selv kan læse budgettet i Firestore.
- Kræver to nye nøgler i Cloudflare (VAPID). På iPhone virker det kun, når appen ligger på hjemmeskærmen (iOS 16.4+).

**Kendte småting**
- En voksen, der har set en bankkontos interne nøgle, kan blokere for, at kontoen kobles på igen. Ingen data kan lække. Løsningen er beskrevet i sikkerhedsgennemgangen: bind nøglen til beviset.
- På en fælles bankkonto kan den ene medejer rette den andens navn og forbindelsesoplysninger på kontoen.
- Hvad der er foldet sammen, og hvilken konto der er valgt, huskes kun på den enkelte enhed.

---

## 5. Det, der ikke er afprøvet rigtigt

- **Banken er kun testet med opdigtede data.** Lasse har koblet Sparekassen Danmark på med 9 konti, og det virker. Men alle beløb stod først som plus. Årsagen var, at koden for udgift var skrevet `DBDT`, og den rigtige er `DBIT`. Det er rettet i version 8, men **ikke bekræftet med hans rigtige data**. Spørg ham, om plus og minus er rigtige nu.
- **Firestore-reglerne er ikke kørt i Firebase-emulatoren.** De er gennemlæst grundigt, og Lasse har udgivet dem uden fejl, men ingen automatisk test dækker dem.
- **Kategorierne** er sat op ud fra kendte danske butiksnavne. De er ikke prøvet på hans rigtige posteringer.
- **Import fra Excel** er testet med skabelonens eksempler, ikke med hans egen fil.
- **Konens bank** er ikke koblet på endnu. Genkendelse af fælleskonti er kun testet med opdigtede data.
- **Færøske banker** står ikke på Enable Bankings liste, så vidt vi ved.

---

## 6. Sådan virker de vigtigste dele

**Poster.** Tre typer: `income`, `expense`, `transfer` (fra `account` til `toAccount`). `freq` er antal måneder mellem betalinger. `payDay` 31 betyder sidste dag i måneden. `pause: { from, to }` sætter posten på pause. `visibleTo` er `['all']` eller en liste af brugere.

**Beregninger (`js/calc.js`).**
- Pr. måned = beløb ÷ `freq`.
- `summarize()` giver `left` (reelt til forbrug) og `onSalary` (på lønkontoen).
- `accountFunding()` fortæller for hver konto, der får overførsler: passer, for meget eller mangler.
- `spendable()` gennemgår 12 måneder dag for dag og finder, hvad man kan bruge uden at mangle til en regning.
- Samme dag kommer indtægter før udgifter. Bankdage (weekend og danske helligdage) kan slås fra pr. budget.

**Indstillinger på budgettet (`settings`).** `balances`, `jointAccounts`, `savingsAccounts`, `mainAccount`, `shareMode` (`'own'` eller `'percent'`), `showJoint`, `jointSplit`, `bank` (Bank-fanen til/fra), `bankDays`, `txRules` (egne kategori-regler).

**Bank (Enable Banking).**
- Hver bruger har sin egen gratis Enable Banking-app og indsætter App-ID og nøglefil (.pem). Nøglen gemmes krypteret i KV med `BANK_SECRET`.
- Kontoens id er et hemmeligt fingeraftryk af kontonummeret. Derfor får den samme fælleskonto samme id hos begge, og den anden bliver medejer med et bevis fra Worker'en.
- Posteringer ligger i `budgets/{id}/bankTx/{konto}_{ÅÅÅÅ-MM}`. `TXV` i `js/bank.js` er formatets version. Hæv den, hvis alt skal hentes igen.
- Flere bankkonti kan høre til samme konto i budgettet. Saldoerne lægges sammen.

**Roller.** `admin`, `edit` (redaktør) og `read` (kun læse). Ejeren af et budget er altid admin.

---

## 7. Sådan opdaterer Lasse

1. **GitHub:** pak zip-filen ud, og upload alt indhold i mappen `budgetbasen` (ikke selve mappen).
2. **Cloudflare** (kun når Worker-koden er ændret): åbn `budgetbasen-files` → Edit code → erstat alt → Deploy.
3. **Firebase** (kun når reglerne er ændret): Firestore → Regler → erstat alt → Udgiv.
4. Luk appen helt og åbn den igen. På computeren: Ctrl+Shift+R.

Der findes en tjekliste til ham som en side hos Claude. Den skal opdateres, hvis trinene ændrer sig.
