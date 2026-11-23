# Cassa di viaggio

App Cassa di viaggio, sviluppata da ALIS Lab. Base di lavoro: Lenovo, workspace Paperclip.

Versione 2.4.0: valute libere. Valuta locale e di riferimento scelte tra tutti i codici ISO 4217 (elenco statico nell'app, ricerca per codice o nome, senza rete); altre valute del viaggio con il loro cambio scritto a mano verso la valuta di riferimento; decimali di ogni valuta (yen e dong 0, dinaro kuwaitiano 3). I dati della v2.3 si migrano senza perdite (schema 5) e i totali restano identici.

## Test

Servono solo Node ≥ 22 e, per gli e2e, Firefox già installato (provato con Firefox ESR 153). Nessun pacchetto da scaricare: `package.json` non ha dipendenze e `npm ci` non va in rete.

```bash
npm test          # test unitari sulla logica (node --test)
npm run e2e       # e2e nel Firefox installato, headless, con viewport da telefono
FIREFOX=/percorso/firefox npm run e2e   # se Firefox non è nel PATH (cerca firefox, poi firefox-esr, poi Firefox.app su macOS)
```

Gli e2e comandano Firefox con WebDriver BiDi tramite il WebSocket integrato in Node (`tests/lib/firefox.mjs`), servono l'app su `http://localhost:8765/` (porta cambiabile con `E2E_PORT`) e simulano il servizio del cambio: nessuna richiesta esce verso internet. Coprono l'aggiornamento dalla v2.1.0, dalla v2.2.0 e dalla v2.3.0 pubblicate con il service worker vero, il primo avvio, la destinazione delle voci, un viaggio in yen con riferimento in dollari e una spesa in won a cambio manuale, l'export CSV, l'offline e quattro schermi; gli screenshot finiscono in `screenshots/` (ignorata da git).

`tests/fixtures/app-v2.1.0/`, `tests/fixtures/app-v2.2.0/` e `tests/fixtures/app-v2.3.0/` sono copie esatte delle versioni pubblicate (2327f8d, cb443f6 e 4f2157c), usate per provare l'aggiornamento: non fanno parte dell'app e contengono ancora i nomi thailandesi della v2.1. `tests/fixtures/data-v2.3.0.json` è il localStorage di un viaggio THB/EUR registrato con la v2.3.0, usato dai test della migrazione. `tests/`, `tools/` e `package.json` servono solo per sviluppo e test.
