// Novità della v2.4 (MAN-423): valute libere. Valuta locale e di riferimento scelte tra tutti i codici ISO 4217
// (elenco statico, ricerca per codice o nome, senza rete), altre valute del viaggio con il loro tasso scritto a mano
// verso la valuta di riferimento, decimali giusti per ogni valuta, migrazione dei dati v2.3 senza perdite.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as C from '../core.js';
import * as C23 from './fixtures/app-v2.3.0/core.js'; // core.js della v2.3.0 pubblicata (4f2157c)

// localStorage reale di un viaggio THB/EUR registrato con la v2.3.0 pubblicata (Firefox, e2e): tappe, spese nelle due
// valute, tasso corretto a mano, voci pagate e previste, un piano.
const V23 = JSON.parse(readFileSync(new URL('./fixtures/data-v2.3.0.json', import.meta.url), 'utf8'));
const v23Input = () => ({
  schema: V23['cdv.schema'],
  expenses: JSON.parse(V23['cdv.expenses']),
  settings: JSON.parse(V23['cdv.settings']),
  plan: JSON.parse(V23['cdv.plan']),
  scenarios: JSON.parse(V23['cdv.piani']),
});

// ---- Elenco delle valute e ricerca ----

test('elenco statico ISO 4217: anche USD, JPY, VND, KWD, KRW; nessun codice inventato', () => {
  for (const c of ['USD', 'JPY', 'VND', 'KWD', 'KRW', 'CHF', 'GBP', 'EUR', 'THB']) assert.ok(C.isCurrency(c), c);
  for (const c of ['XXX', 'usd', '', null, 'EURO']) assert.equal(C.isCurrency(c), false, String(c));
  assert.ok(C.CURRENCY_CODES.length > 140);
  assert.equal(new Set(C.CURRENCY_CODES).size, C.CURRENCY_CODES.length, 'nessun doppione');
});

test('ricerca delle valute per codice e per nome, senza accenti né maiuscole', () => {
  assert.equal(C.searchCurrencies('usd')[0].code, 'USD');
  assert.equal(C.searchCurrencies('USD')[0].code, 'USD');
  assert.equal(C.searchCurrencies('yen')[0].code, 'JPY');
  assert.ok(C.searchCurrencies('dollaro').some((o) => o.code === 'USD'));
  assert.ok(C.searchCurrencies('dollaro').some((o) => o.code === 'CAD'));
  assert.deepEqual(C.searchCurrencies('won').map((o) => o.code).sort(), ['KPW', 'KRW']);
  assert.equal(C.searchCurrencies('dong')[0].code, 'VND');
  // il codice esatto viene prima dei codici che iniziano così
  assert.equal(C.searchCurrencies('eur')[0].code, 'EUR');
  assert.deepEqual(C.searchCurrencies('zzz'), []);
  // senza testo: tutto l'elenco
  assert.equal(C.searchCurrencies('').length, C.currencyOptions().length);
});

test('valute del viaggio: locale, riferimento e altre, senza doppioni e senza codici non validi', () => {
  assert.deepEqual(C.tripCurrencies({ local: 'JPY', home: 'USD' }, ['KRW', 'JPY', 'XXX', 'KRW']), ['JPY', 'USD', 'KRW']);
  assert.deepEqual(C.tripCurrencies({ local: 'EUR', home: 'EUR' }), ['EUR']);
  assert.deepEqual(C.tripCurrencies(null, ['USD']), []);
});

test('simboli: quelli che si confondono passano al simbolo lungo, gli altri restano brevi', () => {
  const s = C.symbolsOf(['USD', 'CAD', 'JPY']);
  assert.notEqual(s.USD, s.CAD);
  assert.equal(s.JPY, '¥');
  // yen e yuan hanno lo stesso simbolo breve
  const y = C.symbolsOf(['JPY', 'CNY']);
  assert.notEqual(y.JPY, y.CNY);
});

// ---- Decimali per valuta ----

test('decimali della valuta: yen e dong 0, euro e dollaro 2, dinaro kuwaitiano 3', () => {
  assert.deepEqual(['JPY', 'VND', 'KRW', 'EUR', 'USD', 'KWD'].map(C.currencyDigits), [0, 0, 0, 2, 2, 3]);
  assert.equal(C.roundAmount(1234.6, 'JPY'), 1235);
  assert.equal(C.roundAmount(1234.567, 'USD'), 1234.57);
  assert.equal(C.roundAmount(1.2345, 'KWD'), 1.235);
});

test('importi scritti e tastierino con i decimali della valuta', () => {
  assert.equal(C.parseAmount('1.500,7', 'JPY'), 1501);
  assert.equal(C.parseAmount('12,345', 'KWD'), 12.345);
  assert.equal(C.parseAmount('12,345', 'USD'), 12.35);
  // punto delle migliaia all'italiana
  assert.equal(C.parseDecimal('1.400'), 1400);
  assert.equal(C.parseDecimal('1.4'), 1.4);
  // yen: la virgola non si scrive
  assert.equal(C.keypadInput('150', ',', 0), '150');
  assert.equal(C.keypadInput('1,23', '4', 3), '1,234');
  assert.equal(C.keypadInput('1,23', '4', 2), '1,23');
  assert.equal(C.fitKeypad('12,50', 0), '12');
  assert.equal(C.fitKeypad('12,5', 2), '12,5');
});

test('spese e voci salvate con i decimali della loro valuta', () => {
  assert.equal(C.makeExpense({ amount: 999.6, currency: 'JPY', category: 'cibo', rate: 160 }).amount, 1000);
  assert.equal(C.makeExpense({ amount: 1.2345, currency: 'KWD', category: 'cibo', rate: 160, xrate: 0.33 }).amount, 1.235);
  assert.throws(() => C.makeExpense({ amount: 0.4, currency: 'JPY', category: 'cibo' }), /importo/);
  assert.equal(C.makePlanItem({ kind: 'volo', amount: 120000.4, currency: 'VND', rate: 26000 }).amount, 120000);
});

test('formati: yen e won senza decimali, dollaro con 2, dinaro kuwaitiano con 3', () => {
  const f = C.makeFormat({ local: 'JPY', home: 'USD', rate: 150, extra: ['KRW', 'KWD'], rates: { KRW: 1400, KWD: 0.31 } });
  assert.equal(f.local(6750), '¥6.750');
  assert.equal(f.home(45), '$45,00');
  assert.equal(f.money(14000, 'KRW'), '₩14.000');
  assert.match(f.money(1.235, 'KWD'), /1,235/);
  assert.equal(f.xrate('KRW', 1400), '1 $ = 1.400,00 ₩');
});

// ---- Conversioni e tassi manuali ----

const FX = { local: 'JPY', home: 'USD', rate: 150, extra: ['KRW'], rates: { KRW: 1400 } };

test('conversione di un\'altra valuta con il tasso manuale verso la valuta di riferimento', () => {
  // 14.000 ₩ / 1400 = 10 $ = 1.500 ¥
  assert.deepEqual(C.convert(14000, 'KRW', 150, FX, 1400), { local: 1500, home: 10 });
  // le due valute del viaggio non cambiano rispetto alla v2.3
  assert.deepEqual(C.convert(3000, 'JPY', 150, FX), { local: 3000, home: 20 });
  assert.deepEqual(C.convert(15, 'USD', 150, FX), { local: 2250, home: 15 });
  // senza tasso: nessun valore inventato
  const none = C.convert(14000, 'KRW', 150, FX, null);
  assert.ok(Number.isNaN(none.local) && Number.isNaN(none.home));
  // senza tasso principale si conosce solo il valore nella valuta di riferimento
  const half = C.convert(14000, 'KRW', null, FX, 1400);
  assert.equal(half.home, 10);
  assert.ok(Number.isNaN(half.local));
  // stessa valuta locale e di riferimento
  assert.deepEqual(C.convert(14000, 'KRW', null, { local: 'USD', home: 'USD', rate: null }, 1400), { local: 10, home: 10 });
});

test('tasso manuale di un\'altra valuta: vale solo per la valuta di riferimento per cui è stato scritto', () => {
  const rates = { KRW: { value: 1400, base: 'USD', mode: 'manual' }, GBP: { value: 0.8, base: 'EUR' } };
  const cur = { local: 'JPY', home: 'USD' };
  assert.equal(C.currentXRate(cur, rates, 'KRW'), 1400);
  assert.equal(C.currentXRate(cur, rates, 'GBP'), null, 'riferito a un\'altra valuta di riferimento');
  assert.equal(C.currentXRate(cur, rates, 'USD'), 1);
  assert.equal(C.currentXRate(cur, rates, 'CHF'), null);
  assert.deepEqual(C.extraRates(cur, ['KRW', 'GBP'], rates), { KRW: 1400, GBP: null });
});

test('ogni spesa tiene il suo tasso: cambiare il tasso manuale non cambia i totali già registrati', () => {
  const a = C.makeExpense({ amount: 14000, currency: 'KRW', category: 'trasporti', rate: 150, xrate: 1400 });
  const b = C.makeExpense({ amount: 3000, currency: 'JPY', category: 'cibo', rate: 150 });
  const c = C.makeExpense({ amount: 15, currency: 'USD', category: 'attivita', rate: 150 });
  assert.equal('xrate' in b, false, 'le valute del viaggio non hanno xrate');
  const list = [a, b, c];
  assert.deepEqual(C.totals(list, FX), { local: 6750, home: 45, count: 3 });
  // nuovo tasso del won: le spese registrate restano; la nuova usa il nuovo tasso
  const fx2 = { ...FX, rates: { KRW: 1250 } };
  assert.deepEqual(C.totals(list, fx2), { local: 6750, home: 45, count: 3 });
  const d = C.makeExpense({ amount: 2500, currency: 'KRW', category: 'cibo', rate: 150, xrate: 1250 });
  assert.deepEqual(C.totals([...list, d], fx2), { local: 7050, home: 47, count: 4 });
  const cats = C.totalsByCategory([...list, d], fx2);
  assert.deepEqual(cats.find((x) => x.id === 'cibo'), { ...C.categoryById('cibo'), local: 3300, home: 22, count: 2 });
});

test('righe in un\'altra valuta senza tasso: ricevono il primo tasso scritto, le altre non si toccano', () => {
  const list = [
    C.makeExpense({ amount: 5000, currency: 'KRW', category: 'cibo', rate: 150, xrate: null }),
    C.makeExpense({ amount: 7000, currency: 'KRW', category: 'cibo', rate: 150, xrate: 1300 }),
    C.makeExpense({ amount: 100, currency: 'JPY', category: 'cibo', rate: 150 }),
  ];
  assert.equal(C.fillMissingXRate(list, 'KRW', 1400), 1);
  assert.deepEqual(list.map((e) => e.xrate), [1400, 1300, undefined]);
  assert.equal(C.fillMissingXRate(list, 'KRW', 0), 0);
});

test('voce del viaggio in un\'altra valuta: pagata tiene il suo tasso, prevista usa quello di oggi', () => {
  const paid = C.makePlanItem({ kind: 'traghetto', amount: 112000, currency: 'KRW', paid: true, rate: 150, xrate: 1400 });
  assert.deepEqual(C.planValue(paid, { ...FX, rates: { KRW: 1000 } }), { local: 12000, home: 80 });
  const planned = C.setPlanPaid(paid, false);
  assert.equal(planned.rate, null);
  assert.equal('xrate' in planned, false);
  assert.deepEqual(C.planValue(planned, { ...FX, rates: { KRW: 1120 } }), { local: 15000, home: 100 });
});

test('importi rapidi in un\'altra valuta: dal suo tasso; senza tasso quelli di riserva', () => {
  const q = C.quickAmounts('KRW', FX);
  assert.equal(q.length, 5);
  assert.ok(q[0] >= 500 && q[0] <= 1000, String(q));
  assert.deepEqual(C.quickAmounts('KRW', { ...FX, rates: {} }), C.QUICK_FALLBACK);
});

test('riepilogo del viaggio coerente con le valute scelte (yen e dollari, una spesa in won)', () => {
  const today = C.dayKey();
  const trip = { start: today, end: C.addDays(today, 9) };
  const expenses = [
    C.makeExpense({ amount: 14000, currency: 'KRW', category: 'trasporti', rate: 150, xrate: 1400 }),
    C.makeExpense({ amount: 3000, currency: 'JPY', category: 'cibo', rate: 150 }),
  ];
  const plan = [C.makePlanItem({ kind: 'traghetto', amount: 112000, currency: 'KRW', paid: true, rate: 150, xrate: 1400 })];
  const s = C.tripSummary({ expenses, plan, budget: null, trip, today, fx: FX });
  const flat = JSON.stringify(s);
  assert.doesNotMatch(flat, /NaN|null,"home":null/);
  const st = C.totalsByStage(expenses, plan, FX, [], 'Giappone');
  assert.equal(st.length, 1);
  assert.equal(st[0].local, 1500 + 3000 + 12000);
  assert.equal(st[0].home, 10 + 20 + 80);
});

test('CSV: con un\'altra valuta una colonna in più con il suo tasso; senza, colonne della v2.3', () => {
  const e = C.makeExpense({ amount: 14000, currency: 'KRW', category: 'trasporti', rate: 150, xrate: 1400 });
  const csv = C.toCSV({ expenses: [e], plan: [], settings: { stages: [] } }, FX).replace(/^﻿/, '').split(/\r\n/);
  assert.equal(csv[0], 'data;ora;tipo;voce;tappa;stato;descrizione;importo;valuta;importo_JPY;importo_USD;JPY_per_USD;modalita;piano;valuta_per_USD');
  assert.match(csv[1], /;14000,00;KRW;1500,00;10,00;150,00;reale;;1400,00$/);
  const fx2 = { local: 'JPY', home: 'USD', rate: 150, extra: [], rates: {} };
  assert.deepEqual(C.csvHeader(fx2), C23.csvHeader({ local: 'JPY', home: 'USD', rate: 150 }));
});

// ---- Migrazione v2.3 → v2.4 con la fixture reale ----

test('migrazione v2.3 → v2.4 (fixture reale): schema 5, nessuna riga persa, righe identiche campo per campo', () => {
  const input = v23Input();
  const before = JSON.stringify(input);
  const m = C.migrateData(input, 1795500000000);
  assert.equal(JSON.stringify(input), before, 'i dati di partenza non si toccano');
  assert.equal(m.schema, 5);
  assert.equal(C.SCHEMA_VERSION, 5);
  assert.equal(m.report.from, 4);
  assert.equal(m.report.dropped, 0);
  assert.deepEqual(m.expenses, input.expenses);
  assert.deepEqual(m.plan, input.plan);
  assert.deepEqual(m.scenarios, input.scenarios);
  // impostazioni: le stesse, più le altre valute del viaggio (nessuna) e i loro tassi
  assert.deepEqual(m.settings, { ...input.settings, extraCurrencies: [], extraRates: {} });
  assert.ok(m.expenses.some((e) => e.currency === 'EUR') && m.expenses.some((e) => e.currency === 'THB'));
});

test('migrazione v2.3 → v2.4: totali identici a quelli calcolati dalla v2.3.0 (reale e piano, giorni, categorie, tappe, CSV)', () => {
  const input = v23Input();
  const m = C.migrateData(input);
  const old = C23.migrateData(v23Input()); // la v2.3.0 sugli stessi dati (già al suo schema)
  const s = m.settings;
  const rate = C.currentRate(s.currencies, s.rate);
  assert.equal(rate, 37.9);
  const fxNew = { ...s.currencies, rate, extra: s.extraCurrencies, rates: C.extraRates(s.currencies, s.extraCurrencies, s.extraRates) };
  const fxOld = { ...old.settings.currencies, rate: C23.currentRate(old.settings.currencies, old.settings.rate) };
  const sets = [
    [m, old],
    ...m.scenarios.map((x, i) => [x, old.scenarios[i]]),
  ];
  assert.equal(sets.length, 2, 'reale più un piano');
  for (const [n, o] of sets) {
    assert.deepEqual(C.totals(n.expenses, fxNew), C23.totals(o.expenses, fxOld));
    assert.deepEqual(C.totalsByCategory(n.expenses, fxNew), C23.totalsByCategory(o.expenses, fxOld));
    assert.deepEqual(C.dailySummary(n.expenses, fxNew), C23.dailySummary(o.expenses, fxOld));
    const st = n.settings.stages;
    assert.deepEqual(C.totalsByStage(n.expenses, n.plan, fxNew, st, s.destination), C23.totalsByStage(o.expenses, o.plan, fxOld, o.settings.stages, old.settings.destination));
    for (const p of n.plan) assert.deepEqual(C.planValue(p, fxNew), C23.planValue(p, fxOld));
    const args = { expenses: n.expenses, plan: n.plan, budget: n.settings.budget, trip: n.settings.trip, today: '2026-11-23' };
    assert.deepEqual(C.tripSummary({ ...args, fx: fxNew }), C23.tripSummary({ ...args, fx: fxOld }));
  }
  const real = { expenses: m.expenses, plan: m.plan, settings: m.settings };
  const realOld = { expenses: old.expenses, plan: old.plan, settings: old.settings };
  assert.equal(C.toCSVAll(real, m.scenarios, fxNew), C23.toCSVAll(realOld, old.scenarios, fxOld), 'CSV identico');
});

test('migrazione v2.3 → v2.4 idempotente e round-trip da localStorage: rieseguita non cambia niente', () => {
  const once = C.migrateData(v23Input());
  // come la salva l'app (JSON in localStorage) e come la rilegge alla riapertura
  const stored = {
    schema: String(once.schema),
    expenses: JSON.parse(JSON.stringify(once.expenses)),
    settings: JSON.parse(JSON.stringify(once.settings)),
    plan: JSON.parse(JSON.stringify(once.plan)),
    scenarios: JSON.parse(JSON.stringify(once.scenarios)),
  };
  const twice = C.migrateData(stored);
  for (const k of ['expenses', 'plan', 'settings', 'scenarios']) assert.deepEqual(twice[k], once[k], k);
  assert.equal(twice.report.from, 5);
  assert.equal(twice.report.dropped, 0);
  // e anche una terza volta
  const third = C.migrateData({ ...stored, schema: '5' });
  assert.deepEqual(third.settings, once.settings);
});

test('dati v2.4 con altre valute: idempotenti; i tassi riferiti a un\'altra valuta di riferimento si scartano', () => {
  const ex = [
    C.makeExpense({ amount: 14000, currency: 'KRW', category: 'trasporti', rate: 150, xrate: 1400 }),
    C.makeExpense({ amount: 3000, currency: 'JPY', category: 'cibo', rate: 150 }),
  ];
  const settings = {
    currencies: { local: 'JPY', home: 'USD' },
    rate: { value: 150, pair: 'JPY/USD', date: '2026-11-23', source: 'manuale', mode: 'manual' },
    trip: { start: '2026-11-20', end: '2026-11-30' },
    stages: [],
    extraCurrencies: ['KRW', 'GBP', 'JPY', 'XXX'],
    extraRates: { KRW: { value: 1400, base: 'USD', mode: 'manual' }, GBP: { value: 0.8, base: 'EUR', mode: 'manual' } },
    inputCurrency: 'KRW',
  };
  const m = C.migrateData({ schema: '5', expenses: ex, settings, plan: [], scenarios: [] });
  assert.deepEqual(m.settings.extraCurrencies, ['KRW', 'GBP']);
  assert.deepEqual(m.settings.extraRates, { KRW: { value: 1400, base: 'USD', mode: 'manual' } });
  assert.equal(m.settings.inputCurrency, 'KRW');
  assert.deepEqual(m.expenses, ex);
  const again = C.migrateData({ schema: '5', expenses: m.expenses, settings: m.settings, plan: m.plan, scenarios: m.scenarios });
  assert.deepEqual(again.settings, m.settings);
  assert.deepEqual(again.expenses, m.expenses);
});

test('migrazione: una riga in una valuta non del viaggio diventa un\'altra valuta (con tasso da scrivere), non si perde', () => {
  const e = { id: 'a', ts: 1795468857547, day: '2026-11-23', amount: 20.5, currency: 'USD', category: 'cibo', stage: null, rate: 38 };
  const m = C.migrateData({ schema: '4', expenses: [e], settings: { currencies: { local: 'THB', home: 'EUR' }, rate: null, stages: [] } });
  assert.deepEqual(m.settings.extraCurrencies, ['USD']);
  assert.deepEqual(m.expenses[0], { ...e, xrate: null });
  assert.equal(m.report.dropped, 0);
});
