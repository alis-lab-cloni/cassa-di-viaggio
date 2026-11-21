// Novità della v2.1 (rese generiche nella v2.2): giorno della spesa scelto a mano, piani ipotetici separati dal reale.
// Esempio: viaggio in Portogallo dall'Italia (stessa valuta) e in Messico (pesos sul posto, euro a casa).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as C from '../core.js';

const TRIP = { start: '2026-11-28', end: '2027-01-02' }; // 36 giorni, a cavallo dell'anno
const FX = { local: 'MXN', home: 'EUR', rate: 20 };
const STAGES = [{ id: 'cdmx', name: 'Città del Messico', start: null, end: null }, { id: 'oax', name: 'Oaxaca', start: null, end: null }];

test('spesa con giorno scelto: passato o futuro; l\'ora di registrazione resta', () => {
  const now = new Date(2026, 11, 3, 21, 40);
  const past = C.makeExpense({ amount: 250, currency: 'MXN', category: 'cibo', stage: 'oax', rate: 20, day: '2026-12-01', now });
  assert.equal(past.day, '2026-12-01');
  assert.equal(past.ts, now.getTime());
  const future = C.makeExpense({ amount: 1500, currency: 'MXN', category: 'attivita', rate: 20, day: '2026-12-10', now });
  assert.equal(future.day, '2026-12-10');
  // senza giorno o con un giorno non valido: il giorno della registrazione
  assert.equal(C.makeExpense({ amount: 1, currency: 'MXN', category: 'cibo', rate: 20, now }).day, '2026-12-03');
  assert.equal(C.makeExpense({ amount: 1, currency: 'MXN', category: 'cibo', rate: 20, day: '3/12', now }).day, '2026-12-03');
});

test('nomi dei giorni: Oggi, Ieri, Domani, poi la data', () => {
  assert.equal(C.formatDay('2026-12-03', '2026-12-03'), 'Oggi');
  assert.equal(C.formatDay('2026-12-02', '2026-12-03'), 'Ieri');
  assert.equal(C.formatDay('2026-12-04', '2026-12-03'), 'Domani');
  assert.match(C.formatDay('2026-12-01', '2026-12-03'), /^Mar 1 dic$/);
  assert.equal(C.formatDay('2026-12-31', '2027-01-01'), 'Ieri', 'anche a cavallo dell\'anno');
  assert.equal(C.formatDayShort('2026-12-03', '2026-12-03'), 'Oggi');
  assert.equal(C.formatDayShort('2026-12-04', '2026-12-03'), 'Domani');
  assert.equal(C.formatDayShort('2026-11-29', '2026-12-03'), '29/11');
});

test('riepilogo e budget del giorno usano il giorno scelto, non quello di registrazione', () => {
  const now = new Date(2026, 11, 3, 10);
  const list = [
    C.makeExpense({ amount: 100, currency: 'MXN', category: 'cibo', rate: 20, now }),
    C.makeExpense({ amount: 700, currency: 'MXN', category: 'cibo', rate: 20, day: '2026-12-02', now }),
    C.makeExpense({ amount: 900, currency: 'MXN', category: 'attivita', rate: 20, day: '2026-12-05', now }),
  ];
  assert.equal(C.totals(C.expensesOfDay(list, '2026-12-03'), FX).local, 100);
  assert.equal(C.totals(C.expensesOfDay(list, '2026-12-02'), FX).local, 700);
  assert.equal(C.dayBudget(C.totals(C.expensesOfDay(list, '2026-12-02'), FX), { amount: 1000, currency: 'MXN' }, FX).remaining, 300);
  assert.deepEqual(C.dailySummary(list, FX).map((d) => [d.day, d.local]), [['2026-12-05', 900], ['2026-12-03', 100], ['2026-12-02', 700]]);
  // spostare una spesa di giorno = cambiare `day`: il totale passa all'altro giorno
  const moved = list.map((e, i) => (i === 0 ? { ...e, day: '2026-12-02' } : e));
  assert.equal(C.totals(C.expensesOfDay(moved, '2026-12-03'), FX).count, 0);
  assert.equal(C.totals(C.expensesOfDay(moved, '2026-12-02'), FX).local, 800);
});

test('proiezione: le spese segnate nei giorni futuri contano una volta sola, senza falsare la media', () => {
  const now = new Date(2026, 11, 2, 12);
  const at = (day, amount) => C.makeExpense({ amount, currency: 'MXN', category: 'cibo', rate: 20, day, now });
  const expenses = [
    at('2026-12-01', 1000),
    at('2026-12-02', 2000), // oggi
    at('2026-12-10', 3000), // segnata in anticipo (es. escursione già prenotata)
    at('2026-12-10', 500),
    at('2026-12-20', 1200),
  ];
  const t = C.tripSummary({ expenses, plan: [], budget: { amount: 1000, currency: 'MXN' }, trip: TRIP, today: '2026-12-02', fx: FX });
  assert.equal(t.daysLeft, 31);
  // speso solo fino a oggi
  assert.equal(t.speso.local, 3000);
  assert.equal(t.daysWithSpending, 2);
  assert.equal(t.avg.local, 1500, 'la media usa solo i giorni fino a oggi');
  assert.equal(t.dailyAhead.local, 4700);
  assert.equal(t.daysAhead, 2);
  assert.equal(t.daysToEstimate, 29);
  assert.equal(t.proiezione.local, 3000 + 4700 + 1500 * 29);
  // senza spese future il conto è quello della v2.0.0
  const base = C.tripSummary({ expenses: expenses.slice(0, 2), plan: [], budget: null, trip: TRIP, today: '2026-12-02', fx: FX });
  assert.equal(base.proiezione.local, 3000 + 1500 * 31);
});

test('piano prima della partenza: le spese ipotizzate per giorno sostituiscono il budget di quei giorni', () => {
  const now = new Date(2026, 10, 19, 12);
  const plan = [C.makePlanItem({ kind: 'volo', amount: 800, currency: 'EUR', paid: false })];
  const expenses = [
    C.makeExpense({ amount: 2500, currency: 'MXN', category: 'cibo', stage: 'cdmx', rate: 20, day: '2026-11-28', now }),
    C.makeExpense({ amount: 1500, currency: 'MXN', category: 'attivita', stage: 'cdmx', rate: 20, day: '2026-11-29', now }),
  ];
  const t = C.tripSummary({ expenses, plan, budget: { amount: 2000, currency: 'MXN' }, trip: TRIP, today: '2026-11-19', fx: FX });
  assert.equal(t.phase, 'before');
  assert.equal(t.speso.local, 0);
  assert.equal(t.avgSource, 'budget');
  // volo 16.000 + giorni ipotizzati 4.000 + budget 2.000 × 34 giorni senza ipotesi
  assert.equal(t.proiezione.local, 16000 + 4000 + 2000 * 34);
  assert.equal(t.previsto.local, 16000 + 2000 * 36);
});

test('CSV: data della spesa scelta, ora solo se registrata quel giorno, colonne modalità e piano', () => {
  const now = new Date(2026, 11, 3, 21, 40);
  const today = C.makeExpense({ amount: 100, currency: 'MXN', category: 'cibo', rate: 20, now });
  const past = C.makeExpense({ amount: 250, currency: 'MXN', category: 'massaggi', stage: 'oax', rate: 20, day: '2026-12-01', now });
  const scen = C.makeScenario({ name: 'Più lungo; con "Yucatán"', trip: TRIP, stages: STAGES, now: now.getTime() });
  scen.expenses.push(C.makeExpense({ amount: 500, currency: 'MXN', category: 'cibo', stage: 'cdmx', rate: 20, day: '2026-12-15', now }));
  scen.plan.push(C.makePlanItem({ kind: 'volo-interno', stage: 'cdmx', amount: 2000, currency: 'MXN', paid: false, now: new Date(2026, 11, 3, 22, 0) }));
  const real = { expenses: [today, past], plan: [], settings: { stages: STAGES } };
  const lines = C.toCSVAll(real, [scen], FX).trim().split('\r\n');
  assert.equal(lines[0], 'data;ora;tipo;voce;tappa;stato;descrizione;importo;valuta;importo_MXN;importo_EUR;MXN_per_EUR;modalita;piano');
  assert.deepEqual(lines.slice(1), [
    '2026-12-01;;spesa;Benessere;Oaxaca;pagato;;250,00;MXN;250,00;12,50;20,00;reale;',
    '2026-12-03;21:40;spesa;Cibo;;pagato;;100,00;MXN;100,00;5,00;20,00;reale;',
    '2026-12-03;22:00;viaggio;Volo interno;Città del Messico;previsto;;2000,00;MXN;2000,00;100,00;20,00;piano;"Più lungo; con ""Yucatán"""',
    '2026-12-15;;spesa;Cibo;Città del Messico;pagato;;500,00;MXN;500,00;25,00;20,00;piano;"Più lungo; con ""Yucatán"""',
  ]);
});

test('piani: vuoti (con date e tappe del reale) o copiati dal reale, sempre separati dal reale', () => {
  const real = {
    expenses: [C.makeExpense({ amount: 300, currency: 'MXN', category: 'cibo', stage: 'oax', rate: 20 })],
    plan: [C.makePlanItem({ kind: 'alloggio', stage: 'oax', amount: 6000, currency: 'MXN', paid: false })],
    settings: { budget: { amount: 2000, currency: 'MXN' }, trip: TRIP, stages: STAGES, stage: 'oax', currencies: { local: 'MXN', home: 'EUR' } },
  };
  const realBefore = JSON.stringify(real);
  const empty = C.makeScenario({ name: '  Piano   1 ', trip: real.settings.trip, stages: real.settings.stages });
  assert.equal(empty.name, 'Piano 1');
  assert.deepEqual([empty.expenses, empty.plan, empty.settings.budget, empty.settings.stage], [[], [], null, null]);
  assert.deepEqual(empty.settings.trip, TRIP);
  assert.deepEqual(empty.settings.stages, STAGES);
  empty.settings.stages.push({ id: 'x', name: 'Nuova', start: null, end: null });
  assert.equal(real.settings.stages.length, 2, 'le tappe del piano sono una copia');

  const copy = C.makeScenario({ name: 'Copia del reale', copyFrom: real });
  assert.deepEqual(copy.expenses, real.expenses);
  assert.deepEqual(copy.plan, real.plan);
  assert.deepEqual(copy.settings, { budget: { amount: 2000, currency: 'MXN' }, trip: TRIP, stages: STAGES, stage: 'oax' });
  // cambiare la copia non tocca il reale
  copy.expenses[0].amount = 999;
  copy.expenses.push(C.makeExpense({ amount: 5000, currency: 'MXN', category: 'altro', rate: 20 }));
  copy.plan[0].paid = true;
  copy.settings.trip.end = '2027-02-01';
  copy.settings.budget.amount = 1;
  copy.settings.stages[0].name = 'Cambiata';
  assert.equal(JSON.stringify(real), realBefore);
  assert.notEqual(C.totals(copy.expenses, FX).local, C.totals(real.expenses, FX).local);

  assert.equal(C.nextScenarioName([]), 'Piano 1');
  assert.equal(C.nextScenarioName([{ name: 'Piano 1' }, { name: 'Piano 3' }]), 'Piano 2');
  assert.equal(C.cleanScenarioName('x'.repeat(60)).length, C.SCENARIO_NAME_MAX);
  assert.equal(C.makeScenario({ name: '   ' }).name, 'Piano');
});

test('stessa valuta (es. dall\'Italia in Portogallo): nessun cambio, tutto in euro', () => {
  const fx = { local: 'EUR', home: 'EUR', rate: C.currentRate({ local: 'EUR', home: 'EUR' }, C.NO_RATE) };
  assert.equal(fx.rate, 1);
  const e = C.makeExpense({ amount: 12.5, currency: 'EUR', category: 'cibo', rate: fx.rate, day: '2027-06-01', now: new Date(2027, 5, 1) });
  const t = C.tripSummary({ expenses: [e], plan: [], budget: { amount: 80, currency: 'EUR' }, trip: { start: '2027-06-01', end: '2027-06-07' }, today: '2027-06-01', fx });
  assert.equal(t.speso.local, 12.5);
  assert.equal(t.speso.home, 12.5);
  assert.equal(t.previsto.local, 560);
  assert.deepEqual(C.quickAmounts('EUR', fx, { amount: 80, currency: 'EUR' }), [1, 2, 5, 10, 20]);
  assert.equal(C.dayBudget(C.totals([e], fx), { amount: 80, currency: 'EUR' }, fx).remainingLocal, 67.5);
});
