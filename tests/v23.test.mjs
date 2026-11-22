// Novità della v2.3 (MAN-405): la destinazione (tappa) di ogni spesa e voce, coerente tra form e riepilogo.
// L'avviso «Destinazione non indicata» compare solo quando l'utente può sceglierla (più tappe);
// con una sola tappa tutto va su quella; senza tappe vale la destinazione del viaggio, senza avviso.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as C from '../core.js';

const FX = { local: 'JPY', home: 'EUR', rate: 160 };
const TOKYO = { id: 'tok', name: 'Tokyo', start: null, end: null };
const KYOTO = { id: 'kyo', name: 'Kyoto', start: null, end: null };

test('destinationOf: nessuna tappa → destinazione del viaggio, nessun avviso', () => {
  assert.deepEqual(C.destinationOf([], null, 'Giappone'), { label: 'Giappone', missing: false });
  assert.deepEqual(C.destinationOf([], 'eliminata', 'Giappone'), { label: 'Giappone', missing: false });
  // senza destinazione del viaggio non si scrive niente (e nessun avviso)
  assert.deepEqual(C.destinationOf([], null), { label: '', missing: false });
});

test('destinationOf: una sola tappa → quella, nessun avviso', () => {
  assert.deepEqual(C.destinationOf([TOKYO], 'tok', 'Giappone'), { label: 'Tokyo', missing: false });
  assert.deepEqual(C.destinationOf([TOKYO], null, 'Giappone'), { label: 'Tokyo', missing: false });
});

test('destinationOf: più tappe → la tappa scelta, oppure l\'avviso se manca', () => {
  assert.deepEqual(C.destinationOf([TOKYO, KYOTO], 'kyo', 'Giappone'), { label: 'Kyoto', missing: false });
  assert.deepEqual(C.destinationOf([TOKYO, KYOTO], null, 'Giappone'), { label: C.NO_DEST_LABEL, missing: true });
  assert.deepEqual(C.destinationOf([TOKYO, KYOTO], 'eliminata'), { label: 'Destinazione non indicata', missing: true });
});

test('assignSingleStage: con una sola tappa le righe senza tappa (o con tappa eliminata) vanno su quella', () => {
  const ex = [
    C.makeExpense({ amount: 1000, currency: 'JPY', category: 'cibo', rate: 160 }),
    C.makeExpense({ amount: 500, currency: 'JPY', category: 'cibo', stage: 'tok', rate: 160 }),
  ];
  const plan = [C.makePlanItem({ kind: 'volo', amount: 800, currency: 'EUR', stage: 'eliminata', paid: true, rate: 160 })];
  const r = C.assignSingleStage(ex, plan, [TOKYO]);
  assert.equal(r.count, 2);
  assert.deepEqual(r.expenses.map((e) => e.stage), ['tok', 'tok']);
  assert.deepEqual(r.plan.map((p) => p.stage), ['tok']);
  // il resto della riga non cambia; gli originali non si toccano
  assert.deepEqual({ ...r.expenses[0], stage: null }, ex[0]);
  assert.equal(ex[0].stage, null);
  // di nuovo: niente da fare, stesse liste
  const again = C.assignSingleStage(r.expenses, r.plan, [TOKYO]);
  assert.equal(again.count, 0);
  assert.equal(again.expenses, r.expenses);
});

test('assignSingleStage: senza tappe o con più tappe non assegna niente', () => {
  const ex = [C.makeExpense({ amount: 1000, currency: 'JPY', category: 'cibo', rate: 160 })];
  for (const stages of [[], [TOKYO, KYOTO]]) {
    const r = C.assignSingleStage(ex, [], stages);
    assert.equal(r.count, 0);
    assert.equal(r.expenses, ex);
  }
});

test('totalsByStage con una sola tappa: una sola riga, anche per le righe ancora senza tappa', () => {
  const ex = [
    C.makeExpense({ amount: 1000, currency: 'JPY', category: 'cibo', rate: 160 }),
    C.makeExpense({ amount: 500, currency: 'JPY', category: 'cibo', stage: 'tok', rate: 160 }),
  ];
  const rows = C.totalsByStage(ex, [], FX, [TOKYO], 'Giappone');
  assert.deepEqual(rows.map((r) => [r.label, r.local, r.missing]), [['Tokyo', 1500, false]]);
});

test('nessuna città preimpostata: le etichette nuove non nominano luoghi', () => {
  for (const t of [C.NO_DEST_LABEL, C.WHOLE_TRIP_LABEL]) assert.doesNotMatch(t, /tokyo|bangkok|phuket|thai|giappone/i);
});
