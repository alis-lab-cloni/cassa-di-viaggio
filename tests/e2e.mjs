// Prova end-to-end nel browser: il Firefox già installato (headless, viewport da telefono), comandato con
// WebDriver BiDi da tests/lib/firefox.mjs. Nessuna dipendenza da npm. Percorso del browser: variabile FIREFOX.
// Il servizio del cambio è simulato: nessuna richiesta esce davvero dalla macchina.
// Uso: npm run e2e   (screenshot in ./screenshots)
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer } from '../tools/serve.mjs';
import { launchFirefox } from './lib/firefox.mjs';

const PORT = Number(process.env.E2E_PORT) || 8765;
const BASE = `http://localhost:${PORT}/`;
const SHOTS = fileURLToPath(new URL('../screenshots/', import.meta.url));
const APP = fileURLToPath(new URL('../', import.meta.url)); // la versione attuale (2.3.0), nella radice del repository
const APP_V21 = fileURLToPath(new URL('./fixtures/app-v2.1.0/', import.meta.url)); // copia esatta della v2.1.0 pubblicata (2327f8d)
const APP_V22 = fileURLToPath(new URL('./fixtures/app-v2.2.0/', import.meta.url)); // copia esatta della v2.2.0 pubblicata (cb443f6)
const DOWNLOADS = mkdtempSync(join(tmpdir(), 'cdv-e2e-download-'));
const CACHE = 'cassa-di-viaggio-v2.3.0';
const NO_DEST = 'Destinazione non indicata';
mkdirSync(SHOTS, { recursive: true });

const DEVICES = [
  { name: 'iPhone SE', viewport: { width: 375, height: 667 } },
  { name: 'Android piccolo', viewport: { width: 360, height: 640 } },
  { name: 'Safari con barre (375x553)', viewport: { width: 375, height: 553 } },
  { name: 'Pixel 7', viewport: { width: 412, height: 915 } },
];

// Tassi simulati: unità locali per 1 unità di casa.
const RATES = { 'THB/EUR': 38, 'JPY/EUR': 162.5 };

let failures = 0;
async function step(name, fn) {
  try {
    await fn();
    console.log('  ✔', name);
  } catch (e) {
    failures++;
    console.log('  ✖', name, '\n    ', String(e.message || e).split('\n').slice(0, 8).join('\n     '));
  }
}

const server = await startServer(PORT, APP);
const browser = await launchFirefox({ downloads: DOWNLOADS });
console.log(`Browser: ${browser.description}`);

async function newPhone(viewport) {
  const page = await browser.newPhone({ viewport, locale: 'it-IT' });
  // Frankfurter v2: /v2/rate/{locale}/{casa} → unità di casa per 1 unità locale; la v1: unità locali per 1 di casa
  await page.route('api.frankfurter.dev', (u) => {
    if (u.pathname.startsWith('/v2/')) {
      const [local, home] = u.pathname.split('/').slice(-2).map((c) => c.toUpperCase());
      return { date: '2026-11-16', base: local, quote: home, rate: 1 / RATES[`${local}/${home}`] };
    }
    const home = u.searchParams.get('base');
    const local = u.searchParams.get('symbols');
    return { amount: 1, base: home, date: '2026-11-16', rates: { [local]: RATES[`${local}/${home}`] } };
  });
  await page.route('open.er-api.com', () => ({ result: 'success', time_last_update_unix: 1794787200, rates: { THB: 38, JPY: 162.5, EUR: 1 } }));
  // gli errori di rete simulati (modalità aereo) non sono errori JavaScript: page.errors li esclude già
  return { context: page, page, external: page.external, errors: page.errors, net: page.net };
}

const text = (page, sel) => page.locator(sel).innerText();
const tapKey = (page, k) => page.tap(`#keypad [data-k="${k}"]`);
const stored = (page, key) => page.evaluate((k) => JSON.parse(localStorage.getItem(k)), key);
const KEYS = ['cdv.expenses', 'cdv.plan', 'cdv.settings', 'cdv.schema', 'cdv.piani'];
const rawStorage = (page) => page.evaluate((keys) => Object.fromEntries(keys.map((k) => [k, localStorage.getItem(k)])), KEYS);
const isoDay = (offset) => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const THAI = /thai|bangkok|phuket|pattaya|samui|phangan|baht|THB|฿/i;

// La versione vecchia si ricarica da sola quando il service worker nuovo prende il controllo:
// durante il ricaricamento la lettura delle cache può fallire, si riprova.
async function waitCache(page, name) {
  let keys = [];
  for (let i = 0; i < 60 && keys.join() !== name; i++) {
    await page.waitForTimeout(250);
    keys = await page.evaluate(() => caches.keys()).catch(() => []);
  }
  return keys;
}

// ============ Aggiornamento v2.1.0 → v2.2 con i dati del viaggio già in corso ============
console.log('\nAggiornamento dalla v2.1.0 pubblicata alla v2.2 (stesso indirizzo, senza reinstallare)');
{
  server.setRoot(APP_V21);
  const { context, page, errors } = await newPhone(DEVICES[0].viewport);
  await page.goto(BASE);
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.waitForFunction(() => document.querySelector('#rate-chip').textContent.includes('38,00'));
  let before;
  await step('v2.1.0: spese, tappe, budget, voci del viaggio e un piano con l\'interfaccia della v2.1.0', async () => {
    assert.equal(await page.evaluate(async () => (await caches.keys()).join()), 'cassa-di-viaggio-v2.1.0');
    await page.tap('.tabs [data-view="settings"]');
    await page.fill('#budget-input', '2000');
    await page.tap('#budget-form button[type="submit"]');
    await page.tap('.tabs [data-view="home"]');
    await page.tap('#quick [data-q="100"]');
    await page.tap('#cats [data-cat="massaggi"]');
    await page.tap('#done');
    await page.tap('#stages [data-stage="phuket"]');
    for (const d of ['1', '2', '0']) await tapKey(page, d);
    await page.tap('#cats [data-cat="cibo"]');
    await page.tap('#done');
    await page.tap('.tabs [data-view="trip"]');
    await page.tap('#plan-add');
    await page.fill('#plan-label', 'Volo A/R');
    await page.fill('#plan-amount', '780');
    await page.tap('#plan-paid [data-paid="1"]');
    await page.tap('#plan-save');
    // una spesa di ieri a Pattaya e un piano ipotetico, nel formato della v2.1.0
    await page.evaluate((day) => {
      const list = JSON.parse(localStorage.getItem('cdv.expenses'));
      list.push({ id: 'ieri-v21', ts: Date.now() - 86400000, day, amount: 450, currency: 'THB', category: 'cibo', stage: 'pattaya', thbPerEur: 37.5 });
      localStorage.setItem('cdv.expenses', JSON.stringify(list));
      const s = JSON.parse(localStorage.getItem('cdv.settings'));
      localStorage.setItem('cdv.piani', JSON.stringify([{
        id: 'p1', name: 'Piano A', createdAt: Date.now(),
        expenses: [{ id: 'pe1', ts: Date.now(), day, amount: 900, currency: 'THB', category: 'attivita', stage: 'koh-samui', thbPerEur: 38 }],
        plan: [], settings: { budget: s.budget, trip: s.trip, stage: 'koh-samui' },
      }]));
    }, isoDay(-1));
    before = await rawStorage(page);
    assert.equal(before['cdv.schema'], '3');
    assert.equal(JSON.parse(before['cdv.expenses']).length, 3);
    assert.equal(JSON.parse(before['cdv.plan']).length, 1);
    assert.deepEqual(JSON.parse(before['cdv.settings']).trip, { start: '2026-11-28', end: '2027-01-02' });
  });

  await step('pubblico la v2.2 allo stesso indirizzo: il service worker nuovo sostituisce la cache v2.1.0', async () => {
    server.setRoot(APP);
    await page.reload();
    assert.deepEqual(await waitCache(page, CACHE), [CACHE]);
    await page.reload();
    await page.waitForSelector('#setup', { state: 'attached', timeout: 10000 });
  });

  await step('migrazione: nessuna configurazione da rifare, il viaggio continua com\'era', async () => {
    assert.equal(await page.locator('#setup').isVisible(), false);
    assert.equal(await page.locator('#view-home').isVisible(), true);
  });

  await step('migrazione: ogni spesa e voce della v2.1.0 c\'è, identica (importo, valuta, giorno, categoria, tappa)', async () => {
    assert.equal(await page.evaluate(() => localStorage.getItem('cdv.schema')), '4');
    const pick = (r) => ({ id: r.id, amount: r.amount, currency: r.currency, day: r.day, category: r.category, stage: r.stage ?? null });
    const old = JSON.parse(before['cdv.expenses']).map(pick).sort((a, b) => a.id.localeCompare(b.id));
    const now = (await stored(page, 'cdv.expenses')).map(pick).sort((a, b) => a.id.localeCompare(b.id));
    assert.deepEqual(now, old);
    const plan = await stored(page, 'cdv.plan');
    assert.equal(plan.length, 1);
    assert.equal(plan[0].amount, 780);
    assert.equal(plan[0].paid, true);
  });

  await step('migrazione: valute, cambio, budget e date del viaggio conservati come dati dell\'utente', async () => {
    const s = await stored(page, 'cdv.settings');
    assert.deepEqual(s.currencies, { local: 'THB', home: 'EUR' });
    assert.deepEqual(s.budget, { amount: 2000, currency: 'THB' });
    assert.deepEqual(s.trip, { start: '2026-11-28', end: '2027-01-02' });
    assert.equal(s.rate.value, 38);
    assert.equal(s.stage, 'phuket');
  });

  await step('migrazione: le tappe usate diventano tappe dell\'utente, modificabili', async () => {
    const s = await stored(page, 'cdv.settings');
    assert.deepEqual(s.stages.map((x) => [x.id, x.name]).sort(), [['bangkok', 'Bangkok'], ['pattaya', 'Pattaya'], ['phuket', 'Phuket']]);
    assert.match(await text(page, '#stages'), /Phuket/);
    await page.tap('.tabs [data-view="settings"]');
    assert.match(await text(page, '#stage-list'), /Pattaya[\s\S]*Phuket|Phuket[\s\S]*Pattaya/);
    await page.tap('.tabs [data-view="home"]');
  });

  await step('migrazione: il piano resta separato, con la sua spesa e la sua tappa', async () => {
    const piani = await stored(page, 'cdv.piani');
    assert.equal(piani.length, 1);
    assert.equal(piani[0].name, 'Piano A');
    assert.equal(piani[0].expenses.length, 1);
    assert.equal(piani[0].expenses[0].amount, 900);
    assert.deepEqual(piani[0].settings.stages.map((x) => x.name), ['Koh Samui']);
  });

  await step('migrazione: copia di sicurezza dei dati v2.1.0 com\'erano in cdv.backup-v3', async () => {
    const backup = await stored(page, 'cdv.backup-v3');
    assert.ok(backup, 'copia di sicurezza assente');
    const flat = JSON.stringify(backup);
    for (const id of ['ieri-v21', 'pe1']) assert.ok(flat.includes(id), `manca ${id} nella copia`);
    assert.ok(flat.includes('thbPerEur'), 'la copia deve avere i dati com\'erano');
  });

  await step('dopo l\'aggiornamento una spesa nuova si aggiunge senza toccare le vecchie', async () => {
    await page.tap('#quick [data-q="100"]');
    await page.tap('#cats [data-cat="cibo"]');
    await page.tap('#done');
    const list = await stored(page, 'cdv.expenses');
    assert.equal(list.length, 4);
    assert.ok(list.some((e) => e.id === 'ieri-v21' && e.amount === 450));
  });

  await step('nessun errore JavaScript', async () => assert.deepEqual(errors, []));
  await context.close();
}

// ============ Primo avvio senza dati: viaggio in Giappone (JPY/EUR) ============
console.log('\nPrimo avvio senza dati: configurazione guidata e viaggio in Giappone (JPY/EUR)');
{
  server.setRoot(APP);
  const { context, page, external, errors, net } = await newPhone(DEVICES[0].viewport);
  await page.goto(BASE);
  await page.evaluate(() => navigator.serviceWorker.ready);

  await step(`service worker attivo e app in cache (${CACHE})`, async () => {
    assert.equal(await page.evaluate(async () => (await caches.keys()).join()), CACHE);
  });

  await step('alla prima apertura: configurazione guidata, nessun viaggio preimpostato', async () => {
    assert.equal(await page.locator('#setup').isVisible(), true);
    assert.equal(await page.locator('#setup-name').inputValue(), '');
    assert.equal(await page.locator('#setup-dest').inputValue(), '');
    assert.equal(await page.locator('#setup-local').inputValue(), '');
    assert.equal(await page.locator('#setup-start').inputValue(), '');
    assert.equal(await page.evaluate(() => localStorage.getItem('cdv.expenses')), null);
    await page.screenshot({ path: SHOTS + 'configurazione-iphone-se.png', fullPage: true });
  });

  await step('testi neutri: nessun riferimento a Thailandia, città o baht nella pagina, nel titolo e nel manifest', async () => {
    const all = await page.evaluate(() => document.documentElement.outerHTML);
    // l'elenco completo delle valute contiene anche il baht: si esclude solo quello
    assert.doesNotMatch(all.replace(/<option[^>]*>[^<]*<\/option>/g, ''), THAI);
    assert.doesNotMatch(await page.title(), THAI);
    assert.doesNotMatch(readFileSync(APP + 'manifest.webmanifest', 'utf8'), THAI);
  });

  await step('elenco completo delle valute (non solo THB/EUR)', async () => {
    const n = await page.locator('#setup-local option:not([value=""])').count();
    assert.ok(n >= 140, `solo ${n} valute`);
    for (const c of ['JPY', 'USD', 'GBP', 'CHF', 'MXN', 'THB']) assert.equal(await page.locator(`#setup-local option[value="${c}"]`).count(), 1, c);
  });

  await step('senza valuta locale non si parte, con un avviso chiaro', async () => {
    await page.tap('#setup-go');
    assert.match(await text(page, '#setup-msg'), /valuta locale/);
    assert.equal(await page.locator('#setup').isVisible(), true);
  });

  await step('configurazione: nome, destinazione, JPY/EUR, date e budget del giorno in yen', async () => {
    await page.fill('#setup-name', 'Giappone in primavera');
    await page.fill('#setup-dest', 'Giappone');
    await page.selectOption('#setup-local', 'JPY');
    await page.selectOption('#setup-home', 'EUR');
    await page.fill('#setup-start', isoDay(0));
    await page.fill('#setup-end', isoDay(13));
    await page.fill('#setup-budget', '15000');
    await page.tap('#setup-go');
    await page.waitForFunction(() => document.querySelector('#rate-chip').textContent.includes('162,50'));
    assert.equal(await page.locator('#setup').isVisible(), false);
    const s = await stored(page, 'cdv.settings');
    assert.deepEqual(s.currencies, { local: 'JPY', home: 'EUR' });
    assert.deepEqual(s.budget, { amount: 15000, currency: 'JPY' });
    assert.equal(s.tripName, 'Giappone in primavera');
    assert.equal(s.destination, 'Giappone');
    assert.deepEqual(s.stages, []);
  });

  await step('zero tappe: la schermata Oggi funziona senza tappe', async () => {
    assert.equal(await page.locator('#stages [data-stage]').count(), 0);
    await page.screenshot({ path: SHOTS + 'oggi-giappone-senza-tappe.png' });
  });

  await step('importi rapidi in yen, sensati per il budget (¥200 … ¥5.000)', async () => {
    assert.deepEqual((await text(page, '#quick')).split('\n').filter(Boolean), ['¥200', '¥500', '¥1.000', '¥2.000', '¥5.000']);
  });

  await step('spesa in 3 tocchi: ¥1.000 → Cibo → Aggiungi spesa, conti in yen ed euro', async () => {
    await page.tap('#quick [data-q="1000"]');
    await page.tap('#cats [data-cat="cibo"]');
    await page.tap('#done');
    assert.equal(await text(page, '#spent-local'), '¥1.000');
    assert.equal(await text(page, '#spent-home'), '€6,15');
    const [e] = await stored(page, 'cdv.expenses');
    assert.equal(e.amount, 1000);
    assert.equal(e.currency, 'JPY');
    assert.equal(e.rate, 162.5);
  });

  await step('spesa in euro con importi rapidi in euro (tasto valuta)', async () => {
    await page.tap('#cur-toggle');
    assert.match(await text(page, '#quick'), /€/);
    await tapKey(page, '2');
    await tapKey(page, '0');
    await page.tap('#cats [data-cat="attivita"]');
    await page.tap('#done');
    await page.tap('#cur-toggle');
    const list = await stored(page, 'cdv.expenses');
    assert.equal(list.length, 2);
    assert.ok(list.some((e) => e.amount === 20 && e.currency === 'EUR'));
  });

  await step('tappe aggiunte dall\'utente, con date facoltative, e scelte con 1 tocco', async () => {
    await page.tap('.tabs [data-view="settings"]');
    await page.fill('#stage-name', 'Tokyo');
    await page.fill('#stage-start', isoDay(0));
    await page.fill('#stage-end', isoDay(6));
    await page.tap('#stage-save');
    await page.fill('#stage-name', 'Kyoto');
    await page.tap('#stage-save');
    assert.match(await text(page, '#stage-list'), /Tokyo[\s\S]*Kyoto/);
    await page.screenshot({ path: SHOTS + 'impostazioni-iphone-se.png', fullPage: true });
    await page.tap('.tabs [data-view="home"]');
    assert.deepEqual((await text(page, '#stages')).split('\n').filter(Boolean), ['Tokyo', 'Kyoto']);
    const kyoto = (await stored(page, 'cdv.settings')).stages.find((x) => x.name === 'Kyoto');
    await page.tap(`#stages [data-stage="${kyoto.id}"]`);
    await page.tap('#quick [data-q="500"]');
    await page.tap('#cats [data-cat="trasporti"]');
    await page.tap('#done');
    assert.equal((await stored(page, 'cdv.expenses')).find((e) => e.amount === 500).stage, kyoto.id);
    await page.screenshot({ path: SHOTS + 'oggi-iphone-se.png' });
  });

  await step('Viaggio: titolo del viaggio dell\'utente', async () => {
    await page.tap('.tabs [data-view="trip"]');
    assert.match(await text(page, '#trip-title'), /Giappone in primavera/);
    await page.screenshot({ path: SHOTS + 'viaggio-iphone-se.png', fullPage: true });
  });

  await step('riepilogo per tappa, in yen ed euro', async () => {
    await page.tap('.tabs [data-view="summary"]');
    const s = await text(page, '#summary');
    assert.match(s, /Kyoto/);
    // v2.3: le spese fatte prima delle tappe sono andate sulla prima tappa (Tokyo), quando era l'unica
    assert.match(s, /Tokyo/);
    assert.doesNotMatch(s, /Senza tappa|Destinazione non indicata/);
    assert.match(s, /¥/);
    assert.doesNotMatch(s, THAI);
    await page.screenshot({ path: SHOTS + 'riepilogo-iphone-se.png', fullPage: true });
  });

  await step('CSV con le valute del viaggio (JPY/EUR) nelle colonne', async () => {
    await page.tap('.tabs [data-view="settings"]');
    const csv = readFileSync(await page.download(() => page.tap('#export'), DOWNLOADS), 'utf8');
    const header = csv.replace(/^﻿/, '').split(/\r?\n/)[0].toLowerCase();
    assert.match(header, /jpy/);
    assert.match(header, /eur/);
    assert.doesNotMatch(csv, THAI);
    assert.match(csv, /Kyoto/);
  });

  await step('offline (modalità aereo): l\'app si riapre con dati, tappe e ultimo tasso', async () => {
    await page.setOffline(true);
    await page.reload();
    await page.waitForSelector('#view-home');
    assert.equal(await page.locator('#setup').isVisible(), false);
    assert.match(await text(page, '#rate-chip'), /162,50/);
    assert.match(await text(page, '#stages'), /Kyoto/);
    await page.setOffline(false);
  });

  await step('nessun dato esce: solo richieste GET al servizio del cambio, senza corpo', async () => {
    assert.ok(external.length > 0);
    for (const r of external) assert.match(r, /^GET (api\.frankfurter\.dev|open\.er-api\.com)\/\S*$/);
  });

  await step('sicurezza: CSP presente e nessuna violazione', async () => {
    assert.ok(await page.locator('meta[http-equiv="Content-Security-Policy"]').count());
    assert.deepEqual(await page.evaluate(() => window.__csp), []);
  });

  await step('nessun errore JavaScript', async () => assert.deepEqual(errors, []));
  await context.close();
}

// ============ v2.3: aggiornamento dalla v2.2.0 con il caso segnalato dal board ============
console.log('\nAggiornamento dalla v2.2.0 pubblicata: voci «Senza tappa» con una sola tappa (caso del board)');
{
  server.setRoot(APP_V22);
  const { context, page, errors } = await newPhone(DEVICES[0].viewport);
  await page.goto(BASE);
  await page.evaluate(() => navigator.serviceWorker.ready);
  await step('v2.2.0: viaggio con destinazione, una spesa e un volo, poi una sola tappa; il riepilogo dice «Senza tappa»', async () => {
    await page.fill('#setup-dest', 'Giappone');
    await page.selectOption('#setup-local', 'JPY');
    await page.selectOption('#setup-home', 'EUR');
    await page.fill('#setup-start', isoDay(0));
    await page.fill('#setup-end', isoDay(9));
    await page.tap('#setup-go');
    await page.waitForFunction(() => document.querySelector('#rate-chip').textContent.includes('162,50'));
    await page.tap('#quick [data-q]');
    await page.tap('#cats [data-cat="cibo"]');
    await page.tap('#done');
    await page.tap('.tabs [data-view="settings"]');
    await page.fill('#stage-name', 'Tokyo');
    await page.tap('#stage-save');
    await page.tap('.tabs [data-view="trip"]');
    await page.tap('#plan-add');
    await page.fill('#plan-amount', '780');
    await page.tap('#plan-paid [data-paid="1"]');
    await page.tap('#plan-save');
    await page.tap('.tabs [data-view="summary"]');
    assert.match(await text(page, '#summary'), /Senza tappa/);
    const rows = [...await stored(page, 'cdv.expenses'), ...await stored(page, 'cdv.plan')];
    assert.deepEqual(rows.map((r) => r.stage), [null, null]);
  });

  await step('pubblico la v2.3: la cache passa alla v2.3.0', async () => {
    server.setRoot(APP);
    await page.reload();
    assert.deepEqual(await waitCache(page, CACHE), [CACHE]);
    await page.reload();
    await page.waitForSelector('#view-home.active');
  });

  await step('dopo l\'aggiornamento: con una sola tappa spesa e volo sono su «Tokyo», nessun avviso', async () => {
    const tokyo = (await stored(page, 'cdv.settings')).stages[0];
    const rows = [...await stored(page, 'cdv.expenses'), ...await stored(page, 'cdv.plan')];
    assert.deepEqual(rows.map((r) => r.stage), [tokyo.id, tokyo.id]);
    await page.tap('.tabs [data-view="summary"]');
    const s = await text(page, '#summary');
    assert.match(s, /Tokyo/);
    assert.doesNotMatch(s, /Senza tappa|Destinazione non indicata/);
    assert.match(await text(page, '#summary-plan'), /Volo[\s\S]*Tokyo/);
  });

  await step('nessun errore JavaScript', async () => assert.deepEqual(errors, []));
  await context.close();
}

// ============ v2.3: destinazione di ogni voce, nel form e nel riepilogo ============
console.log('\nDestinazione delle voci: nessuna tappa, una tappa, più tappe, voce senza destinazione');
{
  server.setRoot(APP);
  const { context, page, errors } = await newPhone(DEVICES[0].viewport);
  await page.goto(BASE);
  const options = () => page.locator('#plan-stage option').allInnerTexts();
  const stagesNow = async () => (await stored(page, 'cdv.settings')).stages;
  const addPlan = async ({ kind = 'volo', label = '', amount, stage, newStage }) => {
    await page.tap('.tabs [data-view="trip"]');
    await page.tap('#plan-add');
    await page.tap(`#plan-kinds [data-kind="${kind}"]`);
    if (label) await page.fill('#plan-label', label);
    await page.fill('#plan-amount', amount);
    if (newStage !== undefined) {
      await page.selectOption('#plan-stage', '__nuova');
      await page.fill('#plan-stage-new', newStage);
    } else if (stage !== undefined) {
      await page.selectOption('#plan-stage', stage);
    }
    await page.tap('#plan-paid [data-paid="1"]');
    await page.tap('#plan-save');
  };
  const pageText = () => page.evaluate(() => document.querySelector('.app').innerText);

  await step('configurazione con destinazione del viaggio («Giappone») e nessuna tappa', async () => {
    await page.fill('#setup-dest', 'Giappone');
    await page.selectOption('#setup-local', 'JPY');
    await page.selectOption('#setup-home', 'EUR');
    await page.fill('#setup-start', isoDay(0));
    await page.fill('#setup-end', isoDay(9));
    await page.tap('#setup-go');
    await page.waitForFunction(() => document.querySelector('#rate-chip').textContent.includes('162,50'));
    await page.tap('#quick [data-q]');
    await page.tap('#cats [data-cat="cibo"]');
    await page.tap('#done');
  });

  await step('nessuna tappa: il form della voce ha il campo destinazione (destinazione del viaggio o nuova)', async () => {
    await page.tap('.tabs [data-view="trip"]');
    await page.tap('#plan-add');
    assert.ok(await page.locator('#plan-stage').isVisible(), 'campo destinazione nascosto');
    assert.match(await text(page, '#plan-stage-field'), /Destinazione/);
    assert.deepEqual(await options(), ['Giappone', 'Nuova destinazione…']);
    assert.equal(await page.locator('#plan-stage').inputValue(), '');
    assert.equal(await page.locator('#plan-stage-new').isVisible(), false);
    await page.tap('#plan-cancel');
    await addPlan({ label: 'andata e ritorno', amount: '780' });
  });

  await step('nessuna tappa: Viaggio e Riepilogo mostrano «Giappone» per la voce e la spesa, nessun avviso', async () => {
    await page.tap('.tabs [data-view="trip"]');
    assert.match(await text(page, '#plan-list'), /andata e ritorno\s*Giappone/);
    await page.tap('.tabs [data-view="summary"]');
    assert.match(await text(page, '#stage-rows'), /Giappone/);
    assert.match(await text(page, '#summary-plan'), /Volo · andata e ritorno\s*Giappone/);
    assert.match(await text(page, '.exp-list'), /Giappone/);
    assert.doesNotMatch(await pageText(), /Senza tappa|Destinazione non indicata/);
    assert.equal(await page.locator('.no-dest').count(), 0);
  });

  await step('nuova destinazione senza nome: avviso chiaro, niente salvato', async () => {
    await page.tap('.tabs [data-view="trip"]');
    await page.tap('#plan-add');
    await page.fill('#plan-amount', '50');
    await page.selectOption('#plan-stage', '__nuova');
    assert.ok(await page.locator('#plan-stage-new').isVisible());
    assert.match(await text(page, '#plan-stage-hint'), /prima tappa/);
    await page.tap('#plan-save');
    assert.match(await text(page, '#plan-msg'), /nome della destinazione/);
    assert.ok(await page.locator('#plan-sheet').isVisible());
    await page.tap('#plan-cancel');
    assert.equal((await stored(page, 'cdv.plan')).length, 1);
  });

  await step('una tappa: la destinazione scritta nella voce diventa la tappa e tutto va su quella, senza avvisi', async () => {
    await addPlan({ kind: 'alloggio', label: 'ryokan', amount: '300', newStage: 'Kyoto' });
    const st = await stagesNow();
    assert.deepEqual(st.map((x) => x.name), ['Kyoto']);
    const rows = [...await stored(page, 'cdv.expenses'), ...await stored(page, 'cdv.plan')];
    assert.deepEqual(rows.map((r) => r.stage), [st[0].id, st[0].id, st[0].id]);
    assert.match(await text(page, '#plan-list'), /ryokan\s*Kyoto/);
    await page.tap('.tabs [data-view="summary"]');
    assert.doesNotMatch(await pageText(), /Senza tappa|Destinazione non indicata/);
    assert.match(await text(page, '#summary-plan'), /andata e ritorno\s*Kyoto[\s\S]*ryokan\s*Kyoto/);
  });

  await step('una tappa: il form propone la tappa, senza «Non indicata»; la schermata Oggi la mostra', async () => {
    await page.tap('.tabs [data-view="trip"]');
    await page.tap('#plan-add');
    assert.deepEqual(await options(), ['Kyoto', 'Nuova destinazione…']);
    assert.equal(await page.locator('#plan-stage').inputValue(), (await stagesNow())[0].id);
    await page.tap('#plan-cancel');
    await page.tap('.tabs [data-view="home"]');
    assert.deepEqual((await text(page, '#stages')).split('\n').filter(Boolean), ['Kyoto']);
  });

  await step('più tappe: seconda destinazione dalla voce; il form offre le tappe, «Non indicata» e «Nuova»', async () => {
    await addPlan({ kind: 'treno', amount: '90', newStage: 'Tokyo' });
    // un nome già presente non crea un doppione
    await addPlan({ kind: 'taxi', amount: '20', newStage: 'tokyo' });
    assert.deepEqual((await stagesNow()).map((x) => x.name), ['Kyoto', 'Tokyo']);
    await page.tap('#plan-add');
    assert.deepEqual(await options(), ['Kyoto', 'Tokyo', 'Non indicata', 'Nuova destinazione…']);
    await page.tap('#plan-cancel');
    await page.tap('.tabs [data-view="summary"]');
    assert.doesNotMatch(await pageText(), /Destinazione non indicata/);
  });

  await step('voce senza destinazione con più tappe: avviso in Viaggio e nel Riepilogo (si può indicare)', async () => {
    await addPlan({ kind: 'bus', label: 'notturno', amount: '40', stage: '' });
    assert.match(await text(page, '#plan-list'), /notturno\s*Destinazione non indicata/);
    await page.tap('.tabs [data-view="summary"]');
    assert.match(await text(page, '#stage-rows'), /Destinazione non indicata/);
    assert.match(await text(page, '#summary-plan'), /Bus · notturno\s*Destinazione non indicata/);
    assert.equal(await page.locator('#summary .no-dest').count(), 2);
    await page.screenshot({ path: SHOTS + 'riepilogo-destinazione-mancante.png', fullPage: true });
  });

  await step('dal Riepilogo un tocco sulla voce apre il form: scelta la tappa, l\'avviso sparisce', async () => {
    await page.tap('#summary-plan [data-plan-edit]', { hasText: 'notturno' });
    assert.ok(await page.locator('#plan-sheet').isVisible());
    assert.equal(await page.locator('#plan-stage').inputValue(), '');
    const tokyo = (await stagesNow()).find((x) => x.name === 'Tokyo');
    await page.selectOption('#plan-stage', tokyo.id);
    await page.tap('#plan-save');
    assert.equal((await stored(page, 'cdv.plan')).find((p) => p.label === 'notturno').stage, tokyo.id);
    assert.match(await text(page, '#summary-plan'), /Bus · notturno\s*Tokyo/);
    assert.doesNotMatch(await pageText(), /Destinazione non indicata/);
  });

  await step('tappa eliminata e ne resta una: le sue voci passano all\'altra, nessun avviso', async () => {
    await page.tap('.tabs [data-view="settings"]');
    const tokyo = (await stagesNow()).find((x) => x.name === 'Tokyo');
    page.onceDialog((d) => d.accept());
    await page.tap(`[data-stage-del="${tokyo.id}"]`);
    const st = await stagesNow();
    assert.deepEqual(st.map((x) => x.name), ['Kyoto']);
    const rows = [...await stored(page, 'cdv.expenses'), ...await stored(page, 'cdv.plan')];
    assert.ok(rows.every((r) => r.stage === st[0].id));
    await page.tap('.tabs [data-view="summary"]');
    assert.doesNotMatch(await pageText(), /Senza tappa|Destinazione non indicata/);
  });

  await step('nessuna città preimpostata: senza destinazione del viaggio il form propone «Tutto il viaggio»', async () => {
    await page.tap('.tabs [data-view="settings"]');
    const kyoto = (await stagesNow())[0];
    page.onceDialog((d) => d.accept());
    await page.tap(`[data-stage-del="${kyoto.id}"]`);
    await page.fill('#info-dest', '');
    await page.tap('#info-form button[type="submit"]');
    await page.tap('.tabs [data-view="trip"]');
    await page.tap('#plan-add');
    assert.deepEqual(await options(), ['Tutto il viaggio', 'Nuova destinazione…']);
    await page.tap('#plan-cancel');
    await page.tap('.tabs [data-view="summary"]');
    assert.match(await text(page, '#stage-rows'), /Tutto il viaggio/);
    assert.doesNotMatch(await pageText(), /Senza tappa|Destinazione non indicata|Giappone|Kyoto|Tokyo/);
  });

  await step('nessun errore JavaScript', async () => assert.deepEqual(errors, []));
  await context.close();
}

// ============ Schermi piccoli e grandi: niente esce dallo schermo ============
console.log('\nSchermi diversi');
for (const d of DEVICES) {
  const { context, page, errors } = await newPhone(d.viewport);
  await page.goto(BASE);
  await step(`${d.name}: configurazione e Oggi senza scorrimento orizzontale`, async () => {
    const noOverflow = () => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
    assert.ok(await noOverflow(), 'configurazione più larga dello schermo');
    await page.selectOption('#setup-local', 'JPY');
    await page.fill('#setup-start', isoDay(0));
    await page.fill('#setup-end', isoDay(10));
    await page.tap('#setup-go');
    await page.waitForFunction(() => document.querySelector('#rate-chip').textContent.includes('162,50'));
    assert.ok(await noOverflow(), 'Oggi più larga dello schermo');
    assert.ok(await page.locator('#done').isVisible());
    await page.screenshot({ path: SHOTS + `oggi-${d.viewport.width}x${d.viewport.height}.png` });
    assert.deepEqual(errors, []);
  });
  await context.close();
}

await browser.close();
server.close();
rmSync(DOWNLOADS, { recursive: true, force: true });
console.log(failures ? `\n${failures} verifiche fallite` : '\nTutte le verifiche e2e superate');
process.exit(failures ? 1 : 0);
