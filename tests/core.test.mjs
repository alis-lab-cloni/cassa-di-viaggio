import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as C from '../core.js';

// Viaggio di esempio: yen sul posto, euro a casa (1 € = 160 ¥).
const JP = { local: 'JPY', home: 'EUR', rate: 160 };

test('categorie: tra 6 e 8, con etichetta e senza emoji (v2 sobria)', () => {
  assert.ok(C.CATEGORIES.length >= 6 && C.CATEGORIES.length <= 8);
  for (const c of C.CATEGORIES) {
    assert.ok(c.id && c.label);
    assert.equal(c.emoji, undefined);
    assert.ok(!/\p{Extended_Pictographic}/u.test(c.label), c.label);
  }
  assert.deepEqual(C.CATEGORIES.map((c) => c.id), ['cibo', 'trasporti', 'alloggio', 'attivita', 'spesa', 'massaggi', 'altro']);
  assert.equal(C.categoryById('massaggi').label, 'Benessere', 'etichetta generica, id storico conservato');
  assert.equal(C.categoryById('sconosciuta').id, 'altro');
});

test('tastierino: cifre, virgola, max 2 decimali, cancella', () => {
  let s = '';
  for (const k of ['1', '2', '0']) s = C.keypadInput(s, k);
  assert.equal(s, '120');
  s = C.keypadInput(s, ',');
  s = C.keypadInput(s, '5');
  s = C.keypadInput(s, '0');
  s = C.keypadInput(s, '9');
  assert.equal(s, '120,50');
  assert.equal(C.keypadInput(s, ','), '120,50');
  assert.equal(C.keypadInput(s, 'back'), '120,5');
  assert.equal(C.keypadInput(s, 'clear'), '');
  assert.equal(C.keypadInput('', ','), '0,');
  assert.equal(C.keypadInput('0', '7'), '7');
  assert.equal(C.keypadInput('', '00'), '0');
  assert.equal(C.keypadInput('5', '00'), '500');
  assert.equal(C.keypadInput('1234567', '8'), '1234567');
  assert.equal(C.keypadInput('1,2', '00'), '1,20');
});

test('parseAmount e parseDecimal: formati italiani e inglesi; i tassi non si arrotondano', () => {
  assert.equal(C.parseAmount('120'), 120);
  assert.equal(C.parseAmount('120,5'), 120.5);
  assert.equal(C.parseAmount('1.234,56'), 1234.56);
  assert.equal(C.parseAmount('12.5'), 12.5);
  assert.equal(C.parseAmount(''), 0);
  assert.equal(C.parseAmount('abc'), 0);
  assert.equal(C.parseAmount('-5'), 0);
  assert.equal(C.parseAmount('0,'), 0);
  assert.equal(C.parseDecimal('0,00615'), 0.00615);
  assert.equal(C.parseDecimal('27.150,5'), 27150.5);
});

test('valute: elenco completo ISO 4217 in corso, nomi in italiano, nessuna coppia preferita', () => {
  assert.ok(C.CURRENCY_CODES.length >= 150, 'valute: ' + C.CURRENCY_CODES.length);
  assert.equal(new Set(C.CURRENCY_CODES).size, C.CURRENCY_CODES.length, 'nessun doppione');
  for (const c of C.CURRENCY_CODES) assert.match(c, /^[A-Z]{3}$/);
  for (const c of ['EUR', 'USD', 'JPY', 'GBP', 'CHF', 'INR', 'MXN', 'BRL', 'ZAR', 'VND', 'IDR', 'KWD', 'XOF', 'THB']) assert.ok(C.isCurrency(c), c);
  for (const c of ['XXX', 'HRK', 'eur', '', null, 'EURO']) assert.ok(!C.isCurrency(c), String(c));
  const opts = C.currencyOptions();
  assert.equal(opts.length, C.CURRENCY_CODES.length);
  assert.equal(opts.find((o) => o.code === 'JPY').name, 'yen giapponese');
  const names = opts.map((o) => o.name);
  assert.deepEqual(names, [...names].sort((a, b) => a.localeCompare(b, 'it')), 'in ordine di nome');
  assert.equal(C.currencyDigits('JPY'), 0);
  assert.equal(C.currencyDigits('EUR'), 2);
  assert.equal(C.currencyDigits('KWD'), 3);
  assert.ok(C.isValidCurrencies({ local: 'JPY', home: 'EUR' }));
  assert.ok(C.isValidCurrencies({ local: 'EUR', home: 'EUR' }), 'la stessa valuta va bene');
  assert.ok(!C.isValidCurrencies({ local: 'JPY' }));
  assert.ok(!C.isValidCurrencies(null));
});

test('simboli: brevi, e senza confusione tra valute con lo stesso simbolo', () => {
  assert.deepEqual(C.currencySymbols('JPY', 'EUR'), { local: '¥', home: '€' });
  assert.deepEqual(C.currencySymbols('GBP', 'EUR'), { local: '£', home: '€' });
  const jc = C.currencySymbols('JPY', 'CNY');
  assert.notEqual(jc.local, jc.home);
  const uc = C.currencySymbols('USD', 'CAD');
  assert.notEqual(uc.local, uc.home);
  assert.deepEqual(C.currencySymbols('EUR', 'EUR'), { local: '€', home: '€' });
});

test('conversioni con il tasso salvato nella spesa, per qualsiasi coppia di valute', () => {
  const jpy = C.makeExpense({ amount: 1600, currency: 'JPY', category: 'cibo', rate: 160 });
  const eur = C.makeExpense({ amount: 10, currency: 'EUR', category: 'altro', rate: 160 });
  assert.deepEqual(C.expenseValue(jpy, JP), { local: 1600, home: 10 });
  assert.deepEqual(C.expenseValue(eur, JP), { local: 1600, home: 10 });
  // valuta di casa con molte unità (yen a casa, euro sul posto)
  const back = { local: 'EUR', home: 'JPY', rate: 0.00625 };
  assert.deepEqual(C.convert(10, 'EUR', 0.00625, back), { local: 10, home: 1600 });
  // stessa valuta: nessuna conversione, nessun tasso necessario
  const same = { local: 'EUR', home: 'EUR', rate: null };
  assert.deepEqual(C.convert(12.5, 'EUR', null, same), { local: 12.5, home: 12.5 });
  assert.equal(C.currentRate({ local: 'EUR', home: 'EUR' }, C.NO_RATE), 1);
  // una valuta che non è del viaggio non si converte a caso
  assert.ok(Number.isNaN(C.convert(5, 'USD', 160, JP).home));
  assert.throws(() => C.makeExpense({ amount: 0, currency: 'JPY', category: 'cibo', rate: 160 }));
  assert.throws(() => C.makeExpense({ amount: 5, currency: 'XYZ', category: 'cibo', rate: 160 }));
});

test('il tasso salvato vale solo per la sua coppia di valute', () => {
  const r = { value: 160, pair: 'JPY/EUR', date: '2026-11-16' };
  assert.equal(C.currentRate({ local: 'JPY', home: 'EUR' }, r), 160);
  assert.equal(C.currentRate({ local: 'USD', home: 'EUR' }, r), null);
  assert.equal(C.currentRate({ local: 'JPY', home: 'EUR' }, C.NO_RATE), null);
  assert.equal(C.currentRate(null, r), null);
});

test('makeExpense: giorno locale e id unici', () => {
  const now = new Date(2026, 10, 28, 23, 59);
  const e = C.makeExpense({ amount: 1, currency: 'JPY', category: 'cibo', rate: 160, now });
  assert.equal(e.day, '2026-11-28');
  assert.equal(e.ts, now.getTime());
  assert.equal(e.stage, null);
  const ids = new Set(Array.from({ length: 200 }, () => C.newId()));
  assert.equal(ids.size, 200);
});

test('stato del budget: verde, giallo, rosso', () => {
  assert.equal(C.budgetStatus(0, 1000).level, 'green');
  assert.equal(C.budgetStatus(0, 1000).face, undefined, 'niente faccine nella v2');
  assert.equal(C.budgetStatus(700, 1000).level, 'green');
  assert.equal(C.budgetStatus(750, 1000).level, 'yellow');
  assert.equal(C.budgetStatus(1000, 1000).level, 'yellow');
  assert.equal(C.budgetStatus(1001, 1000).level, 'red');
  assert.equal(C.budgetStatus(1200, 1000).remaining, -200);
  assert.equal(C.budgetStatus(10, 0).level, 'none');
});

test('dayBudget: budget nella valuta locale o di casa, residuo in entrambe', () => {
  const spent = { local: 8000, home: 50 };
  const inLocal = C.dayBudget(spent, { amount: 16000, currency: 'JPY' }, JP);
  assert.equal(inLocal.level, 'green');
  assert.equal(inLocal.remainingLocal, 8000);
  assert.equal(inLocal.remainingHome, 50);
  const inHome = C.dayBudget(spent, { amount: 60, currency: 'EUR' }, JP);
  assert.equal(inHome.level, 'yellow');
  assert.equal(inHome.remainingHome, 10);
  assert.equal(inHome.remainingLocal, 1600);
  assert.equal(C.dayBudget(spent, null, JP).level, 'none');
});

test('riepilogo per giorno e per categoria', () => {
  const mk = (amount, currency, category, d, h) =>
    C.makeExpense({ amount, currency, category, rate: 160, now: new Date(2026, 10, d, h) });
  const list = [
    mk(800, 'JPY', 'cibo', 28, 9),
    mk(1600, 'JPY', 'cibo', 28, 13),
    mk(3200, 'JPY', 'trasporti', 28, 15),
    mk(10, 'EUR', 'massaggi', 29, 18),
  ];
  const days = C.dailySummary(list, JP);
  assert.deepEqual(days.map((d) => d.day), ['2026-11-29', '2026-11-28']);
  assert.equal(days[1].local, 5600);
  assert.equal(days[1].home, 35);
  assert.equal(days[1].count, 3);
  assert.deepEqual(days[1].categories.map((c) => [c.id, c.local, c.count]), [['trasporti', 3200, 1], ['cibo', 2400, 2]]);
  assert.equal(days[0].local, 1600);
  assert.equal(days[1].expenses[0].amount, 3200, 'spese del giorno dalla più recente');
  assert.equal(C.totals(list, JP).local, 7200);
  assert.equal(C.expensesOfDay(list, '2026-11-29').length, 1);
});

test('tasso: fonti per qualsiasi coppia, risposte lette con le valute del viaggio', () => {
  assert.deepEqual(C.rateUrls({ local: 'JPY', home: 'EUR' }), [
    'https://api.frankfurter.dev/v2/rate/jpy/eur',
    'https://api.frankfurter.dev/v1/latest?base=EUR&symbols=JPY',
    'https://open.er-api.com/v6/latest/EUR',
  ]);
  assert.deepEqual(C.rateUrls({ local: 'EUR', home: 'EUR' }), [], 'stessa valuta: nessuna richiesta');
  assert.deepEqual(C.rateUrls({ local: 'JPY', home: '../x' }), [], 'solo codici noti negli indirizzi');
  const pair = { local: 'JPY', home: 'EUR' };
  assert.deepEqual(
    C.parseFrankfurter({ amount: 1, base: 'EUR', date: '2026-11-16', rates: { JPY: 162.3 } }, pair),
    { value: 162.3, date: '2026-11-16', source: 'frankfurter.app (BCE)' },
  );
  const er = C.parseErApi({ result: 'success', time_last_update_unix: Date.UTC(2026, 10, 17, 0, 2) / 1000, rates: { JPY: 161.9 } }, pair);
  assert.equal(er.value, 161.9);
  assert.match(er.date, /^2026-11-1[67]$/);
  assert.throws(() => C.parseFrankfurter({ date: '2026-11-16', rates: { USD: 1.1 } }, pair), 'valuta assente nella risposta');
  assert.throws(() => C.parseErApi({ result: 'error' }, pair));
  assert.ok(C.isPlausibleRate(162.3));
  assert.ok(C.isPlausibleRate(0.0062));
  assert.ok(C.isPlausibleRate(27150));
  for (const bad of [0, -1, NaN, Infinity, '38', 1e12]) assert.ok(!C.isPlausibleRate(bad), String(bad));
  assert.ok(C.isFarFromRate(16.2, 162), 'uno zero in meno');
  assert.ok(C.isFarFromRate(1620, 162), 'uno zero in più');
  assert.ok(!C.isFarFromRate(170, 162));
  assert.ok(!C.isFarFromRate(170, null), 'senza tasso precedente nessun controllo');
});

test('formattazione in italiano, per valute con e senza decimali', () => {
  const f = C.makeFormat(JP);
  assert.equal(f.local(12345.6), '¥12.346');
  assert.equal(f.home(32.9), '€32,90');
  assert.equal(f.money(1500, 'JPY'), '¥1.500');
  assert.equal(f.money(3.5, 'EUR'), '€3,50');
  assert.equal(f.rate(162.5), '1 € = 162,50 ¥');
  assert.equal(f.local(NaN), '—');
  // valuta «piccola» con decimali (molte unità per 1 €): totali senza decimali, importi con i centesimi se ci sono
  const hu = C.makeFormat({ local: 'MXN', home: 'EUR', rate: 21.4 });
  assert.equal(hu.local(1234.4), '$1.234');
  assert.equal(hu.money(120, 'MXN'), '$120');
  assert.equal(hu.money(120.5, 'MXN'), '$120,50');
  // valuta «grande» (meno di 10 unità per 1 €): sempre con i decimali
  const gb = C.makeFormat({ local: 'GBP', home: 'EUR', rate: 0.86 });
  assert.equal(gb.local(12), '£12,00');
  // simboli fatti di lettere: con lo spazio
  assert.equal(C.makeFormat({ local: 'CHF', home: 'EUR', rate: 0.94 }).local(12.3), 'CHF 12,30');
  // stessa valuta
  const it = C.makeFormat({ local: 'EUR', home: 'EUR', rate: 1 });
  assert.ok(it.same);
  assert.equal(it.local(80), '€80,00');
  assert.equal(C.formatRate(0.00615), '0,00615');
  assert.equal(C.formatKeypad('1234567,5'), '1.234.567,5');
  assert.equal(C.formatKeypad(''), '0');
  assert.equal(C.amountToInput(3.5), '3,50');
  assert.equal(C.amountToInput(120), '120');
  assert.equal(C.formatShortDate('2026-11-28'), '28/11/2026');
  assert.equal(C.formatDay('2026-11-28', '2026-11-28'), 'Oggi');
});

test('CSV: intestazione con le valute del viaggio, separatore ";", virgola decimale, ordine cronologico', () => {
  const stages = [{ id: 'k', name: 'Kyoto', start: null, end: null }];
  const a = C.makeExpense({ amount: 1200, currency: 'JPY', category: 'cibo', stage: 'k', rate: 160, now: new Date(2026, 10, 28, 12, 5) });
  const b = C.makeExpense({ amount: 2.5, currency: 'EUR', category: 'attivita', rate: 160, now: new Date(2026, 10, 27, 8, 0) });
  const csv = C.toCSV({ expenses: [a, b], plan: [], settings: { stages } }, JP);
  const lines = csv.trim().split('\r\n');
  assert.equal(lines[0], 'data;ora;tipo;voce;tappa;stato;descrizione;importo;valuta;importo_JPY;importo_EUR;JPY_per_EUR;modalita;piano');
  assert.equal(lines[1], '2026-11-27;08:00;spesa;Attività;;pagato;;2,50;EUR;400,00;2,50;160,00;reale;');
  assert.equal(lines[2], '2026-11-28;12:05;spesa;Cibo;Kyoto;pagato;;1200,00;JPY;1200,00;7,50;160,00;reale;');
  assert.equal(lines.length, 3);
});

test('niente feedback giocoso nella v2', () => {
  assert.equal(C.cheerFor, undefined);
});

test('tasso Frankfurter v2 (locale→casa) convertito in unità locali per 1 unità di casa', () => {
  const pair = { local: 'JPY', home: 'EUR' };
  const r = C.parseFrankfurterV2({ date: '2026-11-16', base: 'JPY', quote: 'EUR', rate: 0.00616 }, pair);
  assert.equal(r.value, 162.338);
  assert.equal(r.date, '2026-11-16');
  assert.match(r.source, /frankfurter/);
  assert.equal(C.parseFrankfurterV2({ date: '2026-11-16', rates: { EUR: 0.00625 } }, pair).value, 160);
  assert.throws(() => C.parseFrankfurterV2({ date: '2026-11-16', rate: 0 }, pair));
  assert.throws(() => C.parseFrankfurterV2({ rate: 0.006 }, pair));
});

test('senza tasso nessuna conversione inventata', () => {
  const fx = { local: 'JPY', home: 'EUR', rate: null };
  assert.equal(C.currentRate({ local: 'JPY', home: 'EUR' }, C.NO_RATE), null);
  assert.ok(Number.isNaN(C.convert(100, 'JPY', null, fx).home));
  assert.ok(Number.isNaN(C.convert(5, 'EUR', null, fx).local));
  assert.equal(C.convert(100, 'JPY', null, fx).local, 100);
  assert.equal(C.convert(5, 'EUR', null, fx).home, 5);
  const f = C.makeFormat(fx);
  assert.equal(f.home(NaN), '—');
  assert.equal(f.local(NaN), '—');
  assert.equal(C.formatRate(null), '—');
  const e = C.makeExpense({ amount: 1000, currency: 'JPY', category: 'cibo', rate: null });
  assert.equal(e.rate, null);
  // budget in valuta locale e sole spese in valuta locale: lo stato si calcola, il residuo nell'altra valuta no
  const v = C.dayBudget(C.totals([e], fx), { amount: 10000, currency: 'JPY' }, fx);
  assert.equal(v.level, 'green');
  assert.equal(v.remainingLocal, 9000);
  assert.ok(Number.isNaN(v.remainingHome));
  // budget nella valuta di casa con spese locali senza tasso: stato non calcolabile, nessun rosso finto
  assert.equal(C.dayBudget(C.totals([e], fx), { amount: 30, currency: 'EUR' }, fx).level, 'none');
  const csv = C.toCSV({ expenses: [e], plan: [] }, fx).split('\r\n')[1].split(';');
  assert.deepEqual(csv.slice(9, 12), ['1000,00', '', '']);
});

test('il primo tasso vero completa le spese registrate senza tasso', () => {
  const list = [
    C.makeExpense({ amount: 1600, currency: 'JPY', category: 'cibo', rate: null }),
    C.makeExpense({ amount: 2000, currency: 'JPY', category: 'cibo', rate: 150 }),
  ];
  assert.equal(C.fillMissingRate(list, 160), 1);
  assert.equal(list[0].rate, 160);
  assert.equal(list[1].rate, 150, 'le spese con tasso non cambiano');
  assert.equal(C.expenseValue(list[0], JP).home, 10);
  assert.equal(C.fillMissingRate(list, null), 0);
});

test('importi rapidi: sensati per qualsiasi valuta (dal budget, dal cambio o di riserva)', () => {
  // dal budget del giorno: circa 1%, 2,5%, 5%, 10%, 25%
  assert.deepEqual(C.quickAmounts('JPY', JP, { amount: 15000, currency: 'JPY' }), [200, 500, 1000, 2000, 5000]);
  assert.deepEqual(C.quickAmounts('THB', { local: 'THB', home: 'EUR', rate: 38 }, { amount: 2000, currency: 'THB' }), [20, 50, 100, 200, 500]);
  // nella valuta di casa dieci volte tanto (prenotazioni, tour)
  assert.deepEqual(C.quickAmounts('EUR', { local: 'THB', home: 'EUR', rate: 38 }, { amount: 2000, currency: 'THB' }), [5, 10, 20, 50, 100]);
  // budget nella valuta di casa, importi nella valuta locale
  assert.deepEqual(C.quickAmounts('JPY', JP, { amount: 100, currency: 'EUR' }), [200, 500, 1000, 2000, 5000]);
  // senza budget: dal cambio (circa mezza unità di casa)
  assert.deepEqual(C.quickAmounts('JPY', JP, null), [100, 200, 500, 1000, 2000]);
  assert.deepEqual(C.quickAmounts('VND', { local: 'VND', home: 'EUR', rate: 27000 }, null), [10000, 20000, 50000, 100000, 200000]);
  assert.deepEqual(C.quickAmounts('EUR', { local: 'EUR', home: 'EUR', rate: 1 }, null), [1, 2, 5, 10, 20]);
  // senza budget e senza cambio
  assert.deepEqual(C.quickAmounts('JPY', { local: 'JPY', home: 'EUR', rate: null }, null), C.QUICK_FALLBACK);
  // sempre 5 importi crescenti, interi, entro le cifre del tastierino
  for (const [cur, fx] of [['JPY', JP], ['EUR', JP], ['IDR', { local: 'IDR', home: 'EUR', rate: 18000 }], ['KWD', { local: 'KWD', home: 'EUR', rate: 0.33 }]]) {
    const q = C.quickAmounts(cur, fx, null);
    assert.equal(q.length, 5);
    for (let i = 0; i < 5; i++) {
      assert.equal(C.parseAmount(String(q[i])), q[i]);
      assert.ok(Number.isInteger(q[i]) && q[i] >= 1 && String(q[i]).length <= 7);
      if (i) assert.ok(q[i] > q[i - 1]);
    }
  }
});

test('sicurezza: la data del cambio si accetta solo come YYYY-MM-DD', () => {
  const pair = { local: 'JPY', home: 'EUR' };
  assert.ok(C.isISODate('2026-11-16'));
  for (const bad of ['16/11/2026', '2026-11-16<img src=x onerror=alert(1)>', '<b>2026</b>', '', null, undefined, 20261116]) {
    assert.ok(!C.isISODate(bad), String(bad));
  }
  const evil = '2026-<img src=x onerror=alert(1)>';
  assert.throws(() => C.parseFrankfurter({ date: evil, rates: { JPY: 160 } }, pair));
  assert.throws(() => C.parseFrankfurter({ date: '2026-11-16T00:00:00Z', rates: { JPY: 160 } }, pair));
  assert.throws(() => C.parseFrankfurterV2({ date: evil, rate: 0.006 }, pair));
  assert.throws(() => C.parseFrankfurterV2({ date: '<svg onload=x>', rate: 0.006 }, pair));
  // la data si convalida per intero, prima di qualsiasi troncamento: niente suffissi, nemmeno l'ora
  assert.throws(() => C.parseFrankfurterV2({ date: '2026-11-16T00:00:00Z', rate: 0.006 }, pair));
});

test('sicurezza v1.1.2: data con suffisso, troppo lunga o non stringa si scarta in tutte le fonti', () => {
  const pair = { local: 'JPY', home: 'EUR' };
  const bad = ['2026-11-17<script>', '2026-11-17 ', '2026-11-170', '2026-11-17'.padEnd(500, 'x'), 20261117, ['2026-11-17'], { toString: () => '2026-11-17' }, true];
  for (const date of bad) {
    assert.throws(() => C.parseFrankfurterV2({ rate: 0.006, date }, pair), String(date).slice(0, 20));
    assert.throws(() => C.parseFrankfurterV2({ rates: { EUR: 0.006 }, date }, pair), String(date).slice(0, 20));
    assert.throws(() => C.parseFrankfurter({ rates: { JPY: 160 }, date }, pair), String(date).slice(0, 20));
  }
  // il caso segnalato da Cracco
  assert.throws(() => C.parseFrankfurterV2({ rate: 0.006, date: '2026-11-17<script>' }, pair), /non valida/);
  // il valore va controllato per intero anche per il tasso: niente stringhe, array o booleani
  for (const rate of ['0.006', '0.006<script>', [0.006], true, Infinity, NaN, -0.006]) {
    assert.throws(() => C.parseFrankfurterV2({ rate, date: '2026-11-17' }, pair), String(rate));
    assert.throws(() => C.parseFrankfurter({ rates: { JPY: Array.isArray(rate) ? [160] : rate }, date: '2026-11-17' }, pair), String(rate));
    assert.throws(() => C.parseErApi({ result: 'success', time_last_update_unix: 1794787200, rates: { JPY: rate } }, pair), String(rate));
  }
  // open.er-api.com: la data si ricava dall'orario, che deve essere un intero positivo vero
  for (const t of ['1794787200', '1794787200<script>', 1794787200.5, -1, 0, null, undefined, 1e20, [1794787200]]) {
    assert.throws(() => C.parseErApi({ result: 'success', time_last_update_unix: t, rates: { JPY: 160 } }, pair), String(t));
  }
  assert.match(C.parseErApi({ result: 'success', time_last_update_unix: 1794787200, rates: { JPY: 160 } }, pair).date, /^\d{4}-\d{2}-\d{2}$/);
});
