GESTIONALE PRIVATO 2.0 – SUPABASE V1

CONTENUTO
- index.html
- styles.css
- app.js
- config.js
- schema_supabase.sql
- README.txt

COME FARE
1. Crea un progetto su Supabase.
2. Apri SQL Editor su Supabase.
3. Incolla tutto il contenuto di schema_supabase.sql ed eseguilo.
4. In Authentication:
   - abilita Email/Password
   - puoi disattivare la conferma email se vuoi entrare subito
5. Apri Project Settings > API
6. Copia:
   - Project URL
   - anon public key
7. Apri config.js
8. Incolla URL e anon key al posto dei placeholder.
9. Carica tutti i file su GitHub.
10. Pubblica il repository su Vercel, Netlify o GitHub Pages.

IMPORTANTE
- Questa versione è pensata per un solo utente.
- I dati vengono salvati online su Supabase.
- Se apri la web app da telefono e PC, vedi gli stessi dati.

SE USI GITHUB PAGES
Funziona perché questa è una web app statica.

SE VUOI ANDARE VELOCE
- Supabase
- GitHub
- Vercel
è il flusso più semplice.

NOTE TECNICHE
- Il file config.js contiene URL e anon key pubblica.
- La anon key pubblica è pensata per il frontend, ma la protezione vera è fatta dalle policy RLS nel database.
- Non inserire mai la service_role key nel frontend.

PROSSIMO STEP POSSIBILE
- allegati fatture
- cancellazione/modifica record
- inventario
- statistiche
- dashboard più avanzata