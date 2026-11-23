// Funzioni della v2 rese generiche nella v2.2: tappe scelte dall'utente, budget dell'intero viaggio, proiezione,
// CSV con tipo, voce, tappa e stato. Esempio: viaggio in Giappone (yen sul posto, euro a casa, 1 € = 160 ¥).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as C from '../core.js';

const TRIP = { start: '2027-03-01', end: '2027-03-21' }; // 21 giorni
const FX = { local: 'JPY', home: 'EUR', rate: 160 };
const STAGES = [
  { id: 'osa', name: 'Osaka', start: '2027-03-15', end: '2027-03-21' },
  { id: 'tok', name: 'Tokyo', start: '2027-03-01', end: '2027-03-07' },
  { id: 'kyo', name: 'Kyoto', start: '2027-03-08', end: '2027-03-14' },
  { id: 'nar', name: 'Nara', start: null, end: null },
];

test('tappe dell\'utente: nessuna predefinita, nome libero, date facoltative, ordine del viaggio', () => {
  assert.equal(C.STAGES, undefined, 'nessuna tappa preimpostata nel codice');
  const s = C.makeStage({ name: '  Hakone   e dintorni ', start: '2027-03-10', end: '2027-03-11' });
  assert.equal(s.name, 'Hakone e dintorni');
  assert.match(s.id, /^t/);
  assert.deepEqual([s.start, s.end], ['2027-03-10', '2027-03-11']);
  assert.deepEqual(C.makeStage({ name: 'Senza date' }).start, null);
  assert.throws(() => C.makeStage({ name: '   ' }));
  assert.throws(() => C.makeStage({ name: 'X', start: '2027-03-10', end: '2027-03-09' }));
  assert.equal(C.makeStage({ name: 'x'.repeat(80) }).name.length, C.STAGE_NAME_MAX);
  // con le date in ordine di data, poi quelle senza date nell'ordine in cui sono state aggiunte
  assert.deepEqual(C.sortStages(STAGES).map((x) => x.name), ['Tokyo', 'Kyoto', 'Osaka', 'Nara']);
  assert.equal(C.stageLabel(STAGES, 'kyo'), 'Kyoto');
  assert.equal(C.stageLabel(STAGES, null), 'Senza tappa');
  assert.equal(C.stageLabel(STAGES, 'eliminata'), 'Senza tappa');
  assert.equal(C.stageLabel([], 'kyo'), 'Senza tappa');
  // la tappa del giorno, dalle date
  assert.equal(C.stageOfDay(STAGES, '2027-03-09').name, 'Kyoto');
  assert.equal(C.stageOfDay(STAGES, '2027-03-21').name, 'Osaka');
  assert.equal(C.stageOfDay(STAGES, '2027-04-01'), null);
  assert.equal(C.stageOfDay([], '2027-03-09'), null, 'anche nessuna tappa va bene');
  assert.equal(C.stageDates(STAGES[1]), '01/03–07/03');
  assert.equal(C.stageDates(STAGES[3]), '');
  const e = C.makeExpense({ amount: 1000, currency: 'JPY', category: 'cibo', stage: 'kyo', rate: 160 });
  assert.equal(e.stage, 'kyo');
  assert.equal(C.makeExpense({ amount: 1000, currency: 'JPY', category: 'cibo', stage: '', rate: 160 }).stage, null);
});

test('voci del viaggio: voli, alloggi, spostamenti interni; previste al tasso di oggi, pagate al tasso del pagamento', () => {
  assert.deepEqual(C.PLAN_GROUPS.map((g) => g.label), ['Voli', 'Alloggi', 'Spostamenti interni']);
  for (const k of ['volo-interno', 'treno', 'traghetto', 'bus', 'taxi']) assert.equal(C.planKindById(k).group, 'spostamenti');
  const due = C.makePlanItem({ kind: 'alloggio', label: ' Ryokan ', stage: 'kyo', amount: 32000, currency: 'JPY', paid: false, rate: 160 });
  assert.equal(due.label, 'Ryokan');
  assert.equal(due.rate, null, 'una voce prevista non fissa il tasso');
  assert.equal(C.planValue(due, { ...FX, rate: 128 }).home, 250);
  const paid = C.setPlanPaid(due, true, 160);
  assert.equal(paid.rate, 160);
  assert.equal(C.planValue(paid, { ...FX, rate: 128 }).home, 200, 'pagata: vale il tasso del pagamento');
  assert.equal(C.setPlanPaid(paid, false, 128).rate, null);
  assert.throws(() => C.makePlanItem({ kind: 'astronave', amount: 1, currency: 'EUR' }));
  assert.throws(() => C.makePlanItem({ kind: 'volo', amount: 0, currency: 'EUR' }));
  // il primo tasso vero completa le voci pagate senza tasso, non quelle previste
  const list = [{ ...paid, rate: null }, due];
  assert.equal(C.fillMissingRate(list, 159), 1);
  assert.equal(list[0].rate, 159);
  assert.equal(list[1].rate, null);
});

test('date del viaggio: giorni che mancano prima, durante e dopo', () => {
  assert.equal(C.tripDays(TRIP), 21);
  assert.equal(C.daysLeft(TRIP, '2027-02-10'), 21);
  assert.equal(C.daysLeft(TRIP, '2027-03-01'), 20);
  assert.equal(C.daysLeft(TRIP, '2027-03-19'), 2);
  assert.equal(C.daysLeft(TRIP, '2027-03-21'), 0);
  assert.equal(C.daysLeft(TRIP, '2027-04-10'), 0);
  assert.equal(C.tripPhase(TRIP, '2027-02-10'), 'before');
  assert.equal(C.tripPhase(TRIP, '2027-03-10'), 'during');
  assert.equal(C.tripPhase(TRIP, '2027-03-22'), 'after');
  assert.ok(C.isValidTrip(TRIP));
  assert.ok(!C.isValidTrip({ start: '2027-03-21', end: '2027-03-01' }));
  assert.ok(!C.isValidTrip({ start: '01/03/2027', end: '2027-03-21' }));
  assert.ok(!C.isValidTrip(null));
  assert.equal(C.addDays('2027-02-27', 3), '2027-03-02');
  // anche a cavallo dell'anno
  assert.equal(C.tripDays({ start: '2026-12-28', end: '2027-01-03' }), 7);
});

test('quadro del viaggio: previsto, speso e proiezione con la formula spiegata', () => {
  const at = (d, h = 12) => new Date(2027, 2, d, h);
  const expenses = [
    C.makeExpense({ amount: 8000, currency: 'JPY', category: 'cibo', stage: 'tok', rate: 160, now: at(1) }),
    C.makeExpense({ amount: 4000, currency: 'JPY', category: 'massaggi', stage: 'tok', rate: 160, now: at(1, 18) }),
    C.makeExpense({ amount: 12000, currency: 'JPY', category: 'attivita', stage: 'tok', rate: 160, now: at(2) }),
    // prova a casa prima della partenza: non conta nel viaggio
    C.makeExpense({ amount: 5, currency: 'EUR', category: 'cibo', rate: 160, now: new Date(2027, 1, 20) }),
  ];
  const plan = [
    C.makePlanItem({ kind: 'volo', amount: 900, currency: 'EUR', paid: true, rate: 160 }),
    C.makePlanItem({ kind: 'alloggio', stage: 'kyo', amount: 80000, currency: 'JPY', paid: false }),
    C.makePlanItem({ kind: 'treno', stage: 'kyo', amount: 14000, currency: 'JPY', paid: true, rate: 160 }),
  ];
  const budget = { amount: 100, currency: 'EUR' }; // 16.000 ¥ al tasso di 160
  const t = C.tripSummary({ expenses, plan, budget, trip: TRIP, today: '2027-03-02', fx: FX });
  assert.equal(t.days, 21);
  assert.equal(t.daysLeft, 19);
  assert.equal(t.phase, 'during');
  // previsto = voci 144.000 + 80.000 + 14.000 + budget 16.000 × 21
  assert.equal(t.items.local, 238000);
  assert.equal(t.previsto.local, 238000 + 16000 * 21);
  // speso = voci pagate 158.000 + spese del giorno nel viaggio 24.000
  assert.equal(t.speso.local, 182000);
  assert.equal(t.itemsUnpaid.local, 80000);
  // media = 24.000 ¥ su 2 giorni con spese
  assert.equal(t.avgSource, 'spese');
  assert.equal(t.avg.local, 12000);
  // proiezione = speso + da pagare + media × giorni che mancano
  assert.equal(t.proiezione.local, 182000 + 80000 + 12000 * 19);
  assert.equal(t.proiezione.home, t.proiezione.local / 160);
  assert.equal(t.level, 'green');
  assert.equal(t.outside, 1);
  assert.deepEqual(t.groups.map((g) => [g.id, g.items.length, g.total.local]), [['voli', 1, 144000], ['alloggi', 1, 80000], ['spostamenti', 1, 14000]]);
});

test('quadro del viaggio prima della partenza: la media è il budget del giorno; senza budget resta 0', () => {
  const plan = [C.makePlanItem({ kind: 'volo', amount: 1000, currency: 'EUR', paid: true, rate: 160 })];
  const t = C.tripSummary({ expenses: [], plan, budget: { amount: 15000, currency: 'JPY' }, trip: TRIP, today: '2027-02-10', fx: FX });
  assert.equal(t.avgSource, 'budget');
  assert.equal(t.daysLeft, 21);
  assert.equal(t.proiezione.local, 160000 + 15000 * 21);
  assert.equal(t.previsto.local, t.proiezione.local);
  assert.equal(t.level, 'green');
  const n = C.tripSummary({ expenses: [], plan, budget: null, trip: TRIP, today: '2027-02-10', fx: FX });
  assert.equal(n.avgSource, 'nessuna');
  assert.equal(n.proiezione.local, 160000);
  // spese oltre il previsto: giallo fino al +10%, poi rosso
  const over = (amount) => C.tripSummary({
    expenses: [C.makeExpense({ amount, currency: 'JPY', category: 'cibo', rate: 160, now: new Date(2027, 2, 1) })],
    plan: [], budget: { amount: 10000, currency: 'JPY' }, trip: { start: '2027-03-01', end: '2027-03-01' }, today: '2027-03-01', fx: FX,
  });
  assert.equal(over(10000).level, 'green');
  assert.equal(over(11000).level, 'yellow');
  assert.equal(over(12000).level, 'red');
});

test('senza tasso il quadro del viaggio non inventa: le voci nella valuta di casa danno «—»', () => {
  const plan = [C.makePlanItem({ kind: 'volo', amount: 800, currency: 'EUR', paid: false })];
  const t = C.tripSummary({ expenses: [], plan, budget: null, trip: TRIP, today: '2027-02-10', fx: { ...FX, rate: null } });
  assert.ok(Number.isNaN(t.previsto.local));
  assert.equal(t.previsto.home, 800);
  assert.equal(t.level, 'none');
});

test('riepilogo per tappa: spese del giorno più voci pagate, nell\'ordine del viaggio, «Destinazione non indicata» in fondo', () => {
  const ex = [
    C.makeExpense({ amount: 3000, currency: 'JPY', category: 'cibo', stage: 'kyo', rate: 160 }),
    C.makeExpense({ amount: 2000, currency: 'JPY', category: 'cibo', stage: 'tok', rate: 160 }),
    C.makeExpense({ amount: 1000, currency: 'JPY', category: 'cibo', rate: 160 }),
    C.makeExpense({ amount: 500, currency: 'JPY', category: 'cibo', stage: 'tappa-eliminata', rate: 160 }),
  ];
  const plan = [
    C.makePlanItem({ kind: 'alloggio', stage: 'kyo', amount: 40000, currency: 'JPY', paid: true, rate: 160 }),
    C.makePlanItem({ kind: 'alloggio', stage: 'osa', amount: 90000, currency: 'JPY', paid: false }),
  ];
  const rows = C.totalsByStage(ex, plan, FX, STAGES);
  assert.deepEqual(rows.map((r) => [r.label, r.local, r.dailyLocal, r.planLocal]), [
    ['Tokyo', 2000, 2000, 0],
    ['Kyoto', 43000, 3000, 40000],
    ['Destinazione non indicata', 1500, 1500, 0],
  ]);
  assert.equal(rows[1].home, 268.75);
  assert.deepEqual(rows.map((r) => r.missing), [false, false, true]);
  // v2.3: senza tappe tutto va sulla destinazione del viaggio (o «Tutto il viaggio»), senza avviso
  assert.deepEqual(C.totalsByStage(ex, plan, FX, [], 'Giappone').map((r) => [r.label, r.local, r.missing]), [['Giappone', 46500, false]]);
  assert.deepEqual(C.totalsByStage(ex, plan, FX, []).map((r) => [r.label, r.local, r.missing]), [['Tutto il viaggio', 46500, false]]);
});

test('CSV v2: spese e voci del viaggio con tipo, voce, tappa, stato e descrizione', () => {
  const e = C.makeExpense({ amount: 2500, currency: 'JPY', category: 'massaggi', stage: 'osa', rate: 160, now: new Date(2027, 2, 20, 17, 45) });
  const v = C.makePlanItem({ kind: 'volo', label: 'Andata; A/R "eco"', amount: 780, currency: 'EUR', paid: true, rate: 158, now: new Date(2026, 9, 1, 10, 0) });
  const p = C.makePlanItem({ kind: 'treno', stage: 'kyo', amount: 6000, currency: 'JPY', paid: false, now: new Date(2026, 10, 2, 9, 30) });
  const lines = C.toCSV({ expenses: [e], plan: [v, p], settings: { stages: STAGES } }, FX).trim().split('\r\n');
  const header = C.csvHeader(FX);
  assert.equal(lines[0], header.join(';'));
  assert.ok(header.includes('tappa') && header.includes('voce') && header.includes('tipo'));
  assert.equal(lines[1], '2026-10-01;10:00;viaggio;Volo;;pagato;"Andata; A/R ""eco""";780,00;EUR;123240;780,00;158,00;reale;');
  assert.equal(lines[2], '2026-11-02;09:30;viaggio;Treno;Kyoto;previsto;;6000;JPY;6000;37,50;160,00;reale;');
  assert.equal(lines[3], '2027-03-20;17:45;spesa;Benessere;Osaka;pagato;;2500;JPY;2500;15,63;160,00;reale;');
  assert.equal(lines.length, 4);
  // stessa valuta: colonne distinte e cambio 1
  const same = { local: 'EUR', home: 'EUR', rate: 1 };
  assert.deepEqual(C.csvHeader(same).slice(9, 12), ['importo_EUR', 'importo_EUR_casa', 'EUR_per_EUR']);
  const x = C.makeExpense({ amount: 12.5, currency: 'EUR', category: 'cibo', rate: null, now: new Date(2027, 5, 1, 9, 0) });
  assert.equal(C.toCSV({ expenses: [x], plan: [] }, same).trim().split('\r\n')[1], '2027-06-01;09:00;spesa;Cibo;;pagato;;12,50;EUR;12,50;12,50;1,00;reale;');
});
