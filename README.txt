GESTIONALE PRIVATO 2.0 – V4 AUTO ONBOARDING

NOVITÀ
- il cliente in registrazione crea automaticamente la propria ditta
- la Partita IVA è facoltativa
- il supervisor centrale viene collegato automaticamente alle nuove ditte
- il cliente vede solo la propria ditta
- il supervisor vede la schermata selezione ditta

FILE
- index.html
- styles.css
- app.js
- config.js
- schema_supabase.sql
- setup_supervisor.sql
- README.txt

FLUSSO GIUSTO
1. crea progetto Supabase
2. esegui schema_supabase.sql
3. metti Project URL e anon key in config.js
4. pubblica l'app
5. registra prima il TUO account supervisor dall'app
6. esegui setup_supervisor.sql cambiando la tua email
7. da quel momento ogni nuova registrazione cliente:
   - crea profilo
   - crea ditta
   - collega il cliente come owner
   - collega te come supervisor

CAMPI REGISTRAZIONE CLIENTE
- nome ditta (obbligatorio)
- partita IVA (facoltativa)
- telefono (facoltativo)
- email (obbligatoria)
- password (obbligatoria)

NOTA
Se su Supabase lasci attiva la conferma email, il cliente potrebbe dover confermare l'email prima del login.