# Ordini del laboratorio

App per gli ordini interni tra negozio e reparti (Torte, Biscotti, Dolci, Salateria, Pane).
Funziona dal browser del telefono o del computer e si può aggiungere alla schermata Home.

- **Sito**: GitHub Pages (gratis), file in questa cartella
- **Dati e foto**: Supabase, piano gratuito (`supabase/schema.sql`)
- **Calendario Google**: funzione `supabase/functions/calendario`
- **Copia di sicurezza notturna**: progetto privato `ordini-backup`

## Cosa si cambia dall'app (⚙ Impostazioni)
Nome del negozio, reparti con colori e unità, testi dei messaggi, operatori, chi può entrare, link del calendario, download dei dati.

## File
| File | A cosa serve |
|---|---|
| `index.html`, `stile.css`, `app.js` | l'app |
| `stampa.js` | foglio da stampare o salvare in PDF (pulsante Stampa); una copia sta anche in ordini-backup |
| `config.js` | indirizzo e chiave pubblica di Supabase |
| `sw.js`, `manifest.webmanifest`, `icona*` | installazione sul telefono |
| `supabase/schema.sql` | da incollare una volta in Supabase > SQL Editor |
| `supabase/functions/calendario/index.ts` | da incollare in Supabase > Edge Functions |

Gli ordini e i clienti non si cancellano mai: si annullano o si archiviano, e ogni modifica resta nello storico.
