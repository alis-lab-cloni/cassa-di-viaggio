# Cassa di viaggio

App Cassa di viaggio, sviluppata da ALIS Lab. Base di lavoro: Lenovo, workspace Paperclip.

## Test

Servono solo Node ≥ 22 e, per gli e2e, Firefox già installato (provato con Firefox ESR 153). Nessun pacchetto da scaricare: `package.json` non ha dipendenze e `npm ci` non va in rete.

```bash
npm test          # test unitari sulla logica (node --test)
npm run e2e       # e2e nel Firefox installato, headless, con viewport da telefono
FIREFOX=/percorso/firefox npm run e2e   # se Firefox non è nel PATH (cerca firefox, poi firefox-esr, poi Firefox.app su macOS)
```

Gli e2e comandano Firefox con WebDriver BiDi tramite il WebSocket integrato in Node (`tests/lib/firefox.mjs`), servono l'app su `http://localhost:8765/` (porta cambiabile con `E2E_PORT`) e simulano il servizio del cambio: nessuna richiesta esce verso internet. Coprono l'aggiornamento dalla v2.1.0 e dalla v2.2.0 pubblicate con il service worker vero, il primo avvio, la destinazione delle voci, l'export CSV, l'offline e quattro schermi; gli screenshot finiscono in `screenshots/` (ignorata da git).

`tests/fixtures/app-v2.1.0/` e `tests/fixtures/app-v2.2.0/` sono copie esatte delle versioni pubblicate (2327f8d e cb443f6), usate per provare l'aggiornamento: non fanno parte dell'app e contengono ancora i nomi thailandesi della v2.1. `tests/`, `tools/` e `package.json` servono solo per sviluppo e test.
