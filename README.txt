GESTIONALE PRIVATO 2.0 – MULTI COMPANY V2

COSA CAMBIA
- Ogni ditta ha il suo gestionale separato.
- Tu, come supervisor, puoi entrare in più ditte.
- I clienti normali entrano direttamente nella loro ditta.
- La schermata "seleziona ditta" compare solo al supervisor o a chi ha più ditte collegate.

FILE
- index.html
- styles.css
- app.js
- config.js
- schema_supabase.sql
- admin_setup_examples.sql
- README.txt

COME FARE
1. Crea progetto Supabase.
2. Incolla schema_supabase.sql nello SQL Editor.
3. In Auth abilita Email/Password.
4. In config.js metti Project URL e anon key.
5. Registra gli account dall'app:
   - il tuo account supervisor
   - gli account dei clienti
6. Poi apri admin_setup_examples.sql e usa le query di esempio per:
   - creare le ditte
   - impostare il tuo profilo come supervisor
   - collegare ogni account alla propria ditta

LOGICA ACCESSI
- supervisor: può scegliere tra più ditte
- cliente normale: entra direttamente nel proprio gestionale
- ogni tabella operativa è filtrata da company_id
- le policy RLS impediscono l'accesso a ditte non collegate

IMPORTANTE
- questa versione non ha ancora pannello admin per creare ditte dentro l'interfaccia
- la creazione ditte e assegnazioni iniziali si fa da SQL
- è la base giusta per crescere senza mischiare i dati

V5 ALERT + MODIFICA GIORNATA
- dalla dashboard puoi cliccare su un alert
- si apre il dettaglio con le motivazioni
- puoi premere "Modifica questa giornata"
- il form della scheda giornaliera viene compilato automaticamente
- correggi e premi di nuovo "Salva giornata"
- dalla tabella giornate puoi cliccare direttamente sulla data per ricaricare la giornata nel form


V6 MODIFICA / CANCELLA / CONFERMA ALERT
- puoi modificare o cancellare una giornata dalla tabella giornate
- puoi modificare o cancellare banchetti e prenotazioni
- rimosso il pulsante "Carica demo cloud"
- se una giornata genera alert, prima del salvataggio esce una finestra con:
  - elenco alert
  - pulsante "Carica comunque"
  - pulsante "Rivedi"
- dalla dashboard:
  - clic su Fornitori aperti -> apre Fornitori
  - clic su Alert attivi -> ti porta agli alert in dashboard
  - clic su Coperti totali -> apre Scheda giornaliera
  - clic su Incasso ultima giornata -> apre Scheda giornaliera
- clic sugli alert in dashboard -> dettaglio alert + possibilità di modificare la giornata
