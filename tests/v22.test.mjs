// Novità della v2.2: app generica. Nessun viaggio preimpostato (né città, né paese, né valute, né date),
// configurazione al primo avvio, tappe dell'utente, migrazione dalle versioni precedenti senza perdere dati.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import * as C from '../core.js';
// La logica della v2.1.0 pubblicata (copia esatta): serve a confrontare i totali prima e dopo la migrazione.
import * as V21 from './fixtures/app-v2.1.0/core.js';

const APP = new URL('../', import.meta.url);

// ---------- Avvio senza dati ----------

test('primo avvio senza dati: niente viaggio preimpostato, serve la configurazione', () => {
  const m = C.migrateData({});
  assert.equal(m.report.from, 0);
  assert.deepEqual([m.expenses, m.plan, m.scenarios], [[], [], []]);
  const s = m.settings;
  assert.equal(s.currencies, null, 'nessuna valuta');
  assert.equal(s.trip, null, 'nessuna data');
  assert.deepEqual(s.stages, [], 'nessuna tappa');
  assert.equal(s.stage, null);
  assert.equal(s.budget, null);
  assert.equal(s.inputCurrency, null);
  assert.equal(s.tripName, '');
  assert.equal(s.destination, '');
  assert.equal(C.currentRate(s.currencies, s.rate), null);
  assert.ok(C.needsSetup(s), 'al primo avvio si apre la configurazione guidata');
  assert.equal(C.DEFAULT_TRIP, undefined, 'nessuna data di viaggio nel codice');
  assert.equal(C.CURRENCIES, undefined, 'nessuna coppia di valute fissa');
  assert.equal(C.STAGES, undefined, 'nessuna tappa nel codice');
  // anche rieseguita resta vuota
  assert.ok(C.needsSetup(C.migrateData(m).settings));
});

test('configurazione: bastano valute e date; nome, destinazione, budget e tappe sono facoltativi', () => {
  const base = C.migrateData({}).settings;
  assert.ok(C.needsSetup({ ...base, currencies: { local: 'JPY', home: 'EUR' } }), 'mancano le date');
  assert.ok(C.needsSetup({ ...base, trip: { start: '2027-03-01', end: '2027-03-21' } }), 'mancano le valute');
  assert.ok(C.needsSetup({ ...base, currencies: { local: 'JPY', home: 'EUR' }, trip: { start: '2027-03-21', end: '2027-03-01' } }), 'date al contrario');
  assert.ok(!C.needsSetup({ ...base, currencies: { local: 'JPY', home: 'EUR' }, trip: { start: '2027-03-01', end: '2027-03-21' } }));
  assert.ok(!C.needsSetup({ ...base, currencies: { local: 'EUR', home: 'EUR' }, trip: { start: '2027-06-01', end: '2027-06-01' } }), 'stessa valuta, un giorno');
  assert.equal(C.cleanText('  Giappone    in primavera  '), 'Giappone in primavera');
  assert.equal(C.cleanText('x'.repeat(100)).length, C.TEXT_MAX);
});

// ---------- Un viaggio qualsiasi: Giappone, yen sul posto ed euro a casa ----------

// Impostazioni come le salva la configurazione guidata (schema 4).
const JP_SETTINGS = {
  tripName: 'Giappone in primavera',
  destination: 'Giappone',
  currencies: { local: 'JPY', home: 'EUR' },
  inputCurrency: 'JPY',
  rate: { value: 162.5, pair: 'JPY/EUR', date: '2027-02-27', source: 'frankfurter.dev (BCE)', mode: 'auto', fetchedAt: 1803800000000 },
  trip: { start: '2027-03-01', end: '2027-03-14' },
  budget: { amount: 15000, currency: 'JPY' },
  stages: [
    { id: 'ttok', name: 'Tokyo', start: '2027-03-01', end: '2027-03-06' },
    { id: 'tkyo', name: 'Kyoto', start: '2027-03-07', end: '2027-03-14' },
  ],
  stage: 'ttok',
};

test('viaggio in Giappone (JPY/EUR): spese in 3 passi con gli importi rapidi in yen, conti in yen ed euro', () => {
  const s = JP_SETTINGS;
  assert.ok(!C.needsSetup(s));
  const fx = { ...s.currencies, rate: C.currentRate(s.currencies, s.rate) };
  assert.equal(fx.rate, 162.5);
  // importi rapidi in yen dal budget del giorno (15.000 ¥)
  const quick = C.quickAmounts('JPY', fx, s.budget);
  assert.deepEqual(quick, [200, 500, 1000, 2000, 5000]);
  // 3 passi: importo rapido → categoria → Aggiungi (tappa preselezionata, giorno = oggi)
  const now = new Date(2027, 2, 3, 13, 10);
  const e1 = C.makeExpense({ amount: quick[2], currency: s.inputCurrency, category: 'cibo', stage: s.stage, rate: fx.rate, now });
  // importo scritto sul tastierino
  let typed = '';
  for (const k of ['1', '2', '8', '0']) typed = C.keypadInput(typed, k);
  const e2 = C.makeExpense({ amount: C.parseAmount(typed), currency: 'JPY', category: 'trasporti', stage: s.stage, rate: fx.rate, now });
  // una spesa pagata in euro (prenotazione)
  const e3 = C.makeExpense({ amount: 30, currency: 'EUR', category: 'attivita', stage: 'tkyo', rate: fx.rate, day: '2027-03-08', now });
  const list = [e1, e2, e3];
  assert.deepEqual(list.map((e) => [e.amount, e.currency, e.stage, e.day]), [
    [1000, 'JPY', 'ttok', '2027-03-03'], [1280, 'JPY', 'ttok', '2027-03-03'], [30, 'EUR', 'tkyo', '2027-03-08'],
  ]);
  const day = C.totals(C.expensesOfDay(list, '2027-03-03'), fx);
  assert.equal(day.local, 2280);
  assert.equal(day.home, 2280 / 162.5);
  const f = C.makeFormat(fx);
  assert.equal(f.local(day.local), '¥2.280');
  assert.equal(f.home(day.home), '€14,03');
  assert.equal(f.money(quick[2], 'JPY'), '¥1.000');
  const view = C.dayBudget(day, s.budget, fx);
  assert.equal(view.level, 'green');
  assert.equal(f.local(view.remainingLocal), '¥12.720');
  // la tappa del giorno, dalle date
  assert.equal(C.stageOfDay(s.stages, '2027-03-09').name, 'Kyoto');
  // riepilogo per tappa e quadro del viaggio
  assert.deepEqual(C.totalsByStage(list, [], fx, s.stages).map((r) => [r.label, r.local]), [['Tokyo', 2280], ['Kyoto', 4875]]);
  const t = C.tripSummary({ expenses: list, plan: [], budget: s.budget, trip: s.trip, today: '2027-03-03', fx });
  assert.equal(t.days, 14);
  assert.equal(t.previsto.local, 15000 * 14);
  // CSV con le colonne del viaggio
  const csv = C.toCSVAll({ expenses: list, plan: [], settings: s }, [], fx).trim().split('\r\n');
  assert.equal(csv[0], 'data;ora;tipo;voce;tappa;stato;descrizione;importo;valuta;importo_JPY;importo_EUR;JPY_per_EUR;modalita;piano');
  assert.ok(csv.includes('2027-03-08;;spesa;Attività;Kyoto;pagato;;30,00;EUR;4875;30,00;162,50;reale;'), csv.join('\n'));
  // nessuna traccia di altri paesi o valute nei dati di questo viaggio
  assert.doesNotMatch(JSON.stringify([s, list]), /THB|฿|thb/i);
  // e la migrazione (riapertura dell'app) non cambia niente
  const again = C.migrateData({ schema: '4', expenses: list, settings: s, plan: [], scenarios: [] });
  assert.deepEqual(again.expenses, list);
  // (dalla v2.4 si aggiungono solo le altre valute del viaggio, vuote)
  assert.deepEqual(again.settings, { ...s, extraCurrencies: [], extraRates: {} });
  assert.equal(again.report.dropped, 0);
});

test('il cambio di un viaggio non vale per un altro: tasso di un\'altra coppia scartato', () => {
  const s = { ...JP_SETTINGS, currencies: { local: 'KRW', home: 'EUR' } };
  const m = C.migrateData({ schema: 4, expenses: [], settings: s });
  assert.equal(m.settings.rate.value, null);
  assert.equal(C.currentRate(m.settings.currencies, m.settings.rate), null);
});

// ---------- Migrazione dalla v2.1.0 (dati veri del telefono) ----------

// Dati come li salva la v2.1.0 (schema 3): spese con tappe e giorno scelto, voci del viaggio, un piano.
const D = (y, m, d, h = 12, mi = 0) => new Date(y, m - 1, d, h, mi).getTime();
const V21_EXPENSES = [
  { id: 'e1', ts: D(2026, 11, 18, 20, 5), day: '2026-11-18', amount: 4.5, currency: 'EUR', category: 'cibo', stage: null, thbPerEur: 38 },
  { id: 'e2', ts: D(2026, 11, 19, 9), day: '2026-11-29', amount: 300, currency: 'THB', category: 'massaggi', stage: 'bangkok', thbPerEur: 38 },
  { id: 'e3', ts: D(2026, 11, 19, 9, 30), day: '2026-12-02', amount: 80, currency: 'THB', category: 'trasporti', stage: 'pattaya', thbPerEur: null },
  { id: 'e4', ts: D(2026, 11, 19, 10), day: '2026-12-05', amount: 1200, currency: 'THB', category: 'attivita', stage: 'koh-samui', thbPerEur: 37.8, nota: 'campo di una versione futura' },
];
const V21_PLAN = [
  { id: 'p1', ts: D(2026, 10, 1, 10), kind: 'volo', label: 'A/R', stage: null, amount: 780, currency: 'EUR', paid: true, thbPerEur: 38 },
  { id: 'p2', ts: D(2026, 11, 2, 9), kind: 'alloggio', label: 'Hotel', stage: 'phuket', amount: 6000, currency: 'THB', paid: false, thbPerEur: null },
  { id: 'p3', ts: D(2026, 11, 3, 9), kind: 'traghetto', label: '', stage: 'koh-samui', amount: 500, currency: 'THB', paid: true, thbPerEur: 38 },
];
const V21_SETTINGS = {
  budget: { amount: 2000, currency: 'THB' },
  inputCurrency: 'THB',
  rate: { thbPerEur: 38, date: '2026-11-16', source: 'frankfurter.dev (BCE)', mode: 'auto', fetchedAt: 1795300000000 },
  stage: 'phuket',
  trip: { start: '2026-11-28', end: '2027-01-02' },
};
const V21_SCENARIOS = [{
  id: 'sc1', name: 'Più lungo', createdAt: D(2026, 11, 19, 1),
  expenses: [{ id: 's1', ts: D(2026, 11, 19, 1), day: '2027-01-05', amount: 900, currency: 'THB', category: 'cibo', stage: 'koh-phangan', thbPerEur: 38 }],
  plan: [{ id: 'sp1', ts: D(2026, 11, 19, 1), kind: 'volo-interno', label: '', stage: 'phuket', amount: 2000, currency: 'THB', paid: false, thbPerEur: null }],
  settings: { budget: { amount: 1500, currency: 'THB' }, trip: { start: '2026-11-28', end: '2027-01-10' }, stage: 'koh-phangan' },
}];
const V21_DATA = { schema: '3', expenses: V21_EXPENSES, plan: V21_PLAN, settings: V21_SETTINGS, scenarios: V21_SCENARIOS };

// Stesso viaggio letto dalla v2.1 (vecchia logica) e dalla v2.2 (nuova logica): i totali devono coincidere.
function compareTotals(oldSet, newSet, newSettings, today) {
  const fx = { ...newSettings.currencies, rate: C.currentRate(newSettings.currencies, newSettings.rate) };
  const a = V21.totals(oldSet.expenses);
  const b = C.totals(newSet.expenses, fx);
  assert.equal(b.count, a.count);
  assert.equal(b.local, a.thb);
  assert.equal(b.home, a.eur);
  const ta = V21.tripSummary({ expenses: oldSet.expenses, plan: oldSet.plan, budget: oldSet.settings.budget, trip: oldSet.settings.trip, today, thbPerEur: 38 });
  const tb = C.tripSummary({ expenses: newSet.expenses, plan: newSet.plan, budget: newSet.settings.budget, trip: newSet.settings.trip, today, fx });
  for (const k of ['previsto', 'speso', 'proiezione', 'items', 'itemsPaid', 'itemsUnpaid', 'daily', 'dailyAhead', 'avg', 'budgetDay']) {
    assert.equal(tb[k].local, ta[k].thb, k);
    // senza tasso (una spesa registrata offline) il valore in euro è «—» (NaN) in entrambe le versioni
    assert.ok(Number.isNaN(ta[k].eur) ? Number.isNaN(tb[k].home) : Math.abs(tb[k].home - ta[k].eur) < 1e-9, k);
  }
  for (const k of ['days', 'daysLeft', 'phase', 'level', 'outside', 'daysWithSpending', 'daysAhead', 'daysToEstimate', 'avgSource']) assert.equal(tb[k], ta[k], k);
}

test('migrazione v2.1.0 → v2.2: ogni spesa, voce, piano e impostazione resta; è un normale viaggio dell\'utente', () => {
  const before = JSON.stringify(V21_DATA);
  const m = C.migrateData(V21_DATA, 1795400000000);
  assert.equal(JSON.stringify(V21_DATA), before, 'i dati di partenza non si toccano');
  assert.equal(m.schema, C.SCHEMA_VERSION); // 4 nella v2.2/v2.3, 5 dalla v2.4
  assert.deepEqual(m.report, { from: 3, to: C.SCHEMA_VERSION, expenses: 4, plan: 3, scenarios: 1, dropped: 0 });
  // ogni spesa e voce: stessi campi, il tasso si chiama `rate`
  const same = (a, b) => {
    const { thbPerEur, ...rest } = b;
    assert.deepEqual(a, { ...rest, rate: thbPerEur });
  };
  V21_EXPENSES.forEach((e, i) => same(m.expenses[i], e));
  V21_PLAN.forEach((p, i) => same(m.plan[i], p));
  assert.equal(m.expenses[3].nota, 'campo di una versione futura', 'i campi sconosciuti restano');
  // le valute sono quelle con cui erano registrati i dati; il tasso resta, legato alla sua coppia
  const s = m.settings;
  assert.deepEqual(s.currencies, { local: 'THB', home: 'EUR' });
  assert.equal(s.inputCurrency, 'THB');
  assert.deepEqual(s.rate, { value: 38, pair: 'THB/EUR', date: '2026-11-16', source: 'frankfurter.dev (BCE)', mode: 'auto', fetchedAt: 1795300000000 });
  assert.deepEqual(s.budget, { amount: 2000, currency: 'THB' });
  assert.deepEqual(s.trip, { start: '2026-11-28', end: '2027-01-02' });
  // le tappe usate diventano tappe dell'utente, con lo stesso id (nessuna spesa perde la tappa), in ordine di uso
  assert.deepEqual(s.stages.map((x) => [x.id, x.name, x.start, x.end]), [
    ['bangkok', 'Bangkok', null, null],
    ['pattaya', 'Pattaya', null, null],
    ['koh-samui', 'Koh Samui', null, null],
    ['phuket', 'Phuket', null, null],
  ]);
  assert.equal(s.stage, 'phuket', 'la tappa attuale resta');
  for (const e of [...m.expenses, ...m.plan]) if (e.stage) assert.ok(C.stageById(s.stages, e.stage), e.id);
  // nessuna configurazione da rifare: è un viaggio già pronto
  assert.ok(!C.needsSetup(s));
  // totali identici a quelli della v2.1
  compareTotals({ expenses: V21_EXPENSES, plan: V21_PLAN, settings: V21_SETTINGS }, m, s, '2026-12-03');
  compareTotals({ expenses: V21_EXPENSES, plan: V21_PLAN, settings: V21_SETTINGS }, m, s, '2026-11-19');
  // riepilogo per tappa: stessi totali per tappa della v2.1
  const fx = { local: 'THB', home: 'EUR', rate: 38 };
  // (dalla v2.3, con più tappe, «Senza tappa» si chiama «Destinazione non indicata»: i totali non cambiano)
  const oldRows = V21.totalsByStage(V21_EXPENSES, V21_PLAN, 38).map((r) => [r.label === 'Senza tappa' ? C.NO_DEST_LABEL : r.label, r.thb]);
  const newRows = C.totalsByStage(m.expenses, m.plan, fx, s.stages).map((r) => [r.label, r.local]);
  assert.deepEqual(new Map(newRows), new Map(oldRows));
  // CSV: stesse righe della v2.1 (cambia solo il nome delle colonne delle conversioni)
  const oldCsv = V21.toCSVAll({ expenses: V21_EXPENSES, plan: V21_PLAN }, V21_SCENARIOS, 38).trim().split('\r\n');
  const newCsv = C.toCSVAll({ expenses: m.expenses, plan: m.plan, settings: s }, m.scenarios, fx).trim().split('\r\n');
  assert.equal(newCsv[0], 'data;ora;tipo;voce;tappa;stato;descrizione;importo;valuta;importo_THB;importo_EUR;THB_per_EUR;modalita;piano');
  const norm = (l) => l.replace(';Massaggi;', ';Benessere;');
  assert.deepEqual(newCsv.slice(1), oldCsv.slice(1).map(norm));
});

test('migrazione v2.1.0 → v2.2: i piani restano separati, con le loro tappe e i loro totali', () => {
  const m = C.migrateData(V21_DATA);
  const [p] = m.scenarios;
  const [old] = V21_SCENARIOS;
  assert.deepEqual([p.id, p.name, p.createdAt], [old.id, old.name, old.createdAt]);
  assert.deepEqual(p.expenses.map((e) => [e.id, e.day, e.amount, e.currency, e.stage, e.rate]), [['s1', '2027-01-05', 900, 'THB', 'koh-phangan', 38]]);
  assert.deepEqual(p.settings.stages.map((x) => x.name), ['Koh Phangan', 'Phuket']);
  assert.equal(p.settings.stage, 'koh-phangan');
  assert.deepEqual(p.settings.trip, old.settings.trip);
  assert.deepEqual(p.settings.budget, old.settings.budget);
  compareTotals(old, p, m.settings, '2026-12-03');
  // il reale non prende le tappe del piano
  assert.ok(!C.stageById(m.settings.stages, 'koh-phangan'));
});

test('migrazione v2.1.0 → v2.2 rieseguita non cambia niente', () => {
  const once = C.migrateData(V21_DATA);
  const twice = C.migrateData({ schema: once.schema, expenses: once.expenses, plan: once.plan, settings: once.settings, scenarios: once.scenarios });
  for (const k of ['expenses', 'plan', 'settings', 'scenarios']) assert.deepEqual(twice[k], once[k], k);
  assert.equal(twice.report.from, C.SCHEMA_VERSION);
  assert.equal(twice.report.dropped, 0);
});

// ---------- Migrazione da versioni più vecchie ----------

const V1_EXPENSES = [
  { id: 'mi3k2x1abcd', ts: D(2026, 11, 20, 9, 15), day: '2026-11-20', amount: 3.5, currency: 'EUR', category: 'cibo', thbPerEur: 38.0952 },
  { id: 'mi3k2x2efgh', ts: D(2026, 11, 20, 13), day: '2026-11-20', amount: 120, currency: 'THB', category: 'trasporti', thbPerEur: 38.0952 },
  { id: 'mi3k2x3ijkl', ts: D(2026, 11, 21, 18, 30), day: '2026-11-21', amount: 10, currency: 'EUR', category: 'attivita', thbPerEur: null },
];
const V1_SETTINGS = {
  budget: { amount: 50, currency: 'EUR' },
  inputCurrency: 'EUR',
  rate: { thbPerEur: 38.5, date: '2026-11-21', source: 'manuale', mode: 'manual', fetchedAt: 1795000000000 },
};

test('migrazione v1.1.2 → v2.2: nessuna spesa persa; mancano solo le date, che chiede la configurazione', () => {
  const m = C.migrateData({ schema: null, expenses: V1_EXPENSES, settings: V1_SETTINGS });
  assert.deepEqual(m.report, { from: 1, to: C.SCHEMA_VERSION, expenses: 3, plan: 0, scenarios: 0, dropped: 0 });
  V1_EXPENSES.forEach((e, i) => {
    const { thbPerEur, ...rest } = e;
    assert.deepEqual(m.expenses[i], { ...rest, stage: null, rate: thbPerEur });
  });
  assert.deepEqual(m.settings.currencies, { local: 'THB', home: 'EUR' });
  assert.deepEqual(m.settings.budget, { amount: 50, currency: 'EUR' });
  assert.equal(m.settings.inputCurrency, 'EUR');
  assert.equal(m.settings.rate.value, 38.5);
  assert.equal(m.settings.rate.mode, 'manual');
  assert.deepEqual(m.settings.stages, [], 'la v1 non aveva tappe');
  assert.equal(m.settings.trip, null, 'nessuna data inventata');
  assert.ok(C.needsSetup(m.settings), 'la configurazione chiede le date; le spese restano');
  const fx = { local: 'THB', home: 'EUR', rate: 38.5 };
  const a = V21.totals(V1_EXPENSES);
  const b = C.totals(m.expenses, fx);
  assert.deepEqual([b.local, b.home, b.count], [a.thb, a.eur, a.count]);
});

test('migrazione v2.0.0 → v2.2: tappe e voci conservate', () => {
  const v20 = {
    schema: 2,
    expenses: [{ id: 'a', ts: D(2026, 11, 19, 9), day: '2026-11-19', amount: 300, currency: 'THB', category: 'massaggi', stage: 'bangkok', thbPerEur: 38 }],
    plan: [{ id: 'b', ts: D(2026, 11, 2, 9), kind: 'bus', label: '', stage: 'pattaya', amount: 300, currency: 'THB', paid: true, thbPerEur: 38 }],
    settings: { budget: { amount: 2000, currency: 'THB' }, inputCurrency: 'THB', rate: { thbPerEur: 38, date: '2026-11-16', source: 'x', mode: 'auto', fetchedAt: 1 }, stage: 'bangkok', trip: { start: '2026-11-28', end: '2027-01-02' } },
  };
  const m = C.migrateData(v20);
  assert.equal(m.report.from, 2);
  assert.deepEqual(m.settings.stages.map((s) => s.name), ['Bangkok', 'Pattaya']);
  assert.equal(m.expenses[0].stage, 'bangkok');
  assert.equal(m.plan[0].stage, 'pattaya');
  assert.equal(m.plan[0].rate, 38);
  assert.ok(!C.needsSetup(m.settings));
  // v2.0.0 → v2.1.0 (vecchia migrazione) → v2.2 dà lo stesso risultato del passaggio diretto
  const via21 = V21.migrateData(v20);
  const step = C.migrateData(via21);
  for (const k of ['expenses', 'plan']) assert.deepEqual(step[k], m[k], k);
  for (const k of ['currencies', 'budget', 'trip', 'stages', 'stage', 'rate', 'inputCurrency']) assert.deepEqual(step.settings[k], m.settings[k], k);
});

test('migrazione: dati sporchi o parziali non bloccano e non si perdono in silenzio', () => {
  const m = C.migrateData({
    expenses: [
      { id: 'a', ts: 1795000000000, day: '2026-11-20', amount: '150', currency: 'THB', category: 'inventata', thbPerEur: '38', stage: '<img src=x>', nota: 'campo extra' },
      { id: 'a', ts: 1795000000001, day: '2026-11-20', amount: 10, currency: 'EUR', category: 'cibo', thbPerEur: 38 }, // id doppio
      { amount: 20, currency: 'THB', category: 'cibo', day: '2026-11-21' }, // senza id né ora
      { id: 'x', amount: 0, currency: 'THB' },
      null,
      'testo',
    ],
    settings: { budget: { amount: 'abc' }, rate: { thbPerEur: 37.5, source: 'default', date: '2026-01-01' }, stage: 'una-tappa', trip: { start: '2027-02-01', end: '2027-01-01' } },
  }, 1795000000000);
  assert.equal(m.expenses.length, 3);
  assert.equal(m.report.dropped, 3);
  assert.equal(m.expenses[0].amount, 150);
  assert.equal(m.expenses[0].rate, 38);
  assert.equal(m.expenses[0].category, 'altro');
  assert.equal(m.expenses[0].nota, 'campo extra', 'i campi sconosciuti restano');
  assert.equal(m.expenses[0].stage, null, 'una tappa con caratteri strani non diventa una tappa');
  assert.notEqual(m.expenses[1].id, 'a', 'id doppio reso unico');
  assert.ok(m.expenses[2].id && m.expenses[2].ts > 0);
  assert.equal(m.expenses[2].day, '2026-11-21');
  assert.equal(m.settings.budget, null);
  assert.equal(m.settings.rate.value, null, 'il tasso indicativo delle prime prove non è un tasso vero');
  assert.deepEqual(m.settings.stages.map((s) => s.name), ['Una Tappa']);
  assert.equal(m.settings.trip, null, 'date non valide: le chiede la configurazione');
  // dati v2.2 sporchi: tappe illeggibili scartate, valute non del viaggio ricondotte alla valuta locale
  const v4 = C.migrateData({
    schema: 4,
    expenses: [{ id: 'q', ts: 1, day: '2027-03-01', amount: 5, currency: 'ZZZ', category: 'cibo', stage: 'nessuna', rate: 160 }],
    settings: {
      currencies: { local: 'JPY', home: 'EUR' }, inputCurrency: 'USD', budget: { amount: 10, currency: 'USD' },
      stages: [{ id: 't1', name: '  Tokyo ', start: '2027-03-05', end: '2027-03-01' }, { id: 't1', name: 'doppia' }, { name: 'senza id' }, 'x'],
      trip: { start: '2027-03-01', end: '2027-03-10' },
    },
  });
  assert.deepEqual(v4.settings.stages, [{ id: 't1', name: 'Tokyo', start: '2027-03-01', end: '2027-03-05' }]);
  assert.equal(v4.expenses[0].currency, 'JPY');
  assert.equal(v4.expenses[0].stage, null);
  assert.equal(v4.settings.inputCurrency, 'JPY');
  assert.deepEqual(v4.settings.budget, { amount: 10, currency: 'JPY' });
});

test('nome delle tappe delle versioni precedenti ricavato dall\'id, senza elenchi di città nel codice', () => {
  assert.equal(C.legacyStageName('koh-phangan'), 'Koh Phangan');
  assert.equal(C.legacyStageName('roma'), 'Roma');
  assert.equal(C.legacyStageName('---'), 'Tappa');
});

// ---------- Nessun riferimento preimpostato nel codice dell'app ----------

test('grep: nell\'app non restano Thailandia, città, baht o THB come predefiniti', () => {
  const files = readdirSync(APP).filter((f) => /\.(js|html|css|webmanifest)$/.test(f));
  assert.deepEqual(files.sort(), ['app.js', 'core.js', 'index.html', 'manifest.webmanifest', 'styles.css', 'sw.js']);
  const forbidden = /thai|bangkok|phuket|pattaya|samui|phangan|chiang|krabi|baht|฿|THB|28\/11|2\/1\b|2026-11-28|2027-01-02/i;
  const hits = [];
  for (const f of files) {
    readFileSync(new URL(f, APP), 'utf8').split('\n').forEach((line, i) => {
      if (!forbidden.test(line)) return;
      // eccezioni ammesse, tutte in core.js: l'elenco completo ISO 4217 (che contiene anche THB) e la coppia
      // con cui le versioni 1.x–2.1 salvavano i dati, usata solo per migrarli
      const isoList = f === 'core.js' && /^\s+('[A-Z]{3}', )+('[A-Z]{3}',?)?$/.test(line);
      const legacy = f === 'core.js' && /^export const LEGACY_CURRENCIES = |^const LEGACY_RATE_FIELD = /.test(line);
      if (!isoList && !legacy) hits.push(`${f}:${i + 1}: ${line.trim()}`);
    });
  }
  assert.deepEqual(hits, []);
  // titolo e descrizione della PWA neutri
  const manifest = JSON.parse(readFileSync(new URL('manifest.webmanifest', APP), 'utf8'));
  assert.equal(manifest.name, 'Cassa di viaggio');
  assert.doesNotMatch(manifest.description, /thai|baht|euro/i);
  const html = readFileSync(new URL('index.html', APP), 'utf8');
  assert.match(html, /<title>Cassa di viaggio<\/title>/);
  // nessuna monetizzazione: niente pubblicità, abbonamenti, acquisti o servizi di terze parti oltre al cambio
  assert.doesNotMatch(html + readFileSync(new URL('app.js', APP), 'utf8'), /abbonament|pubblicit|adsbygoogle|premium|in-app|stripe|paypal|analytics|gtag/i);
  assert.match(html, /connect-src https:\/\/api\.frankfurter\.dev https:\/\/open\.er-api\.com;/);
  // il codice legacy è circoscritto: un solo punto con la vecchia coppia
  const core = readFileSync(new URL('core.js', APP), 'utf8');
  assert.equal(core.match(/'THB'/g).length, 2, 'THB solo nell\'elenco ISO e nella coppia delle vecchie versioni');
});
