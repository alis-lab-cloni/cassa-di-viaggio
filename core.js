// Logica pura della Cassa di viaggio: niente DOM, niente rete. Testata con `node --test`.

export const CATEGORIES = [
  { id: 'cibo', label: 'Cibo' },
  { id: 'trasporti', label: 'Trasporti' },
  { id: 'alloggio', label: 'Alloggio' },
  { id: 'attivita', label: 'Attività' },
  { id: 'spesa', label: 'Spesa' },
  { id: 'massaggi', label: 'Massaggi' },
  { id: 'altro', label: 'Altro' },
];

// Tappe nell'ordine del viaggio. `short` serve dove lo spazio è poco (riga delle tappe nella Cassa).
export const STAGES = [
  { id: 'bangkok', label: 'Bangkok', short: 'Bangkok' },
  { id: 'pattaya', label: 'Pattaya', short: 'Pattaya' },
  { id: 'phuket', label: 'Phuket', short: 'Phuket' },
  { id: 'koh-samui', label: 'Koh Samui', short: 'Samui' },
  { id: 'koh-phangan', label: 'Koh Phangan', short: 'Phangan' },
];

export const NO_STAGE_LABEL = 'Senza tappa';

// Voci del budget del viaggio: voli, alloggi e spostamenti interni.
export const PLAN_GROUPS = [
  { id: 'voli', label: 'Voli' },
  { id: 'alloggi', label: 'Alloggi' },
  { id: 'spostamenti', label: 'Spostamenti interni' },
];

export const PLAN_KINDS = [
  { id: 'volo', label: 'Volo', group: 'voli' },
  { id: 'alloggio', label: 'Alloggio', group: 'alloggi' },
  { id: 'volo-interno', label: 'Volo interno', group: 'spostamenti' },
  { id: 'traghetto', label: 'Traghetto', group: 'spostamenti' },
  { id: 'bus', label: 'Bus', group: 'spostamenti' },
  { id: 'taxi', label: 'Taxi / transfer', group: 'spostamenti' },
];

// Date del viaggio (giorni locali, estremi inclusi). Si possono cambiare in Impostazioni.
export const DEFAULT_TRIP = { start: '2026-11-28', end: '2027-01-02' };

export const CURRENCIES = { THB: '฿', EUR: '€' };

// Importi rapidi sopra il tastierino: un tocco = importo inserito.
export const QUICK_AMOUNTS = { THB: [20, 50, 100, 200, 500], EUR: [5, 10, 20, 50, 100] };

export function quickAmounts(currency) {
  return QUICK_AMOUNTS[currency] || QUICK_AMOUNTS.THB;
}

// Nessun tasso ancora: non si inventano conversioni finché non arriva un tasso vero o uno manuale.
export const NO_RATE = { thbPerEur: null, date: null, source: 'nessuno' };

export function hasRate(r) {
  return !!r && r.thbPerEur > 0;
}

export function categoryById(id) {
  return CATEGORIES.find((c) => c.id === id) || CATEGORIES[CATEGORIES.length - 1];
}

export function stageById(id) {
  return STAGES.find((s) => s.id === id) || null;
}

export function stageLabel(id) {
  const s = stageById(id);
  return s ? s.label : NO_STAGE_LABEL;
}

export function planKindById(id) {
  return PLAN_KINDS.find((k) => k.id === id) || null;
}

const round2 = (n) => Math.round(n * 100) / 100;

// Senza tasso la conversione è NaN (si mostra «—»), mai un valore inventato.
export function toTHB(amount, currency, thbPerEur) {
  if (currency !== 'EUR') return amount;
  return thbPerEur > 0 ? amount * thbPerEur : NaN;
}

export function toEUR(amount, currency, thbPerEur) {
  if (currency === 'EUR') return amount;
  return thbPerEur > 0 ? amount / thbPerEur : NaN;
}

// Spese (e voci già pagate) registrate quando non c'era ancora un tasso: ricevono il primo tasso vero.
// Le voci ancora da pagare non hanno un tasso proprio: usano sempre quello attuale.
// Restituisce quante righe sono state completate.
export function fillMissingRate(list, thbPerEur) {
  if (!(thbPerEur > 0)) return 0;
  let n = 0;
  for (const e of list) {
    if (e.paid === false) continue;
    if (!(e.thbPerEur > 0)) {
      e.thbPerEur = thbPerEur;
      n += 1;
    }
  }
  return n;
}

// Una spesa conserva importo e valuta originali più il tasso del momento:
// così i totali dei giorni passati non cambiano quando il tasso si aggiorna.
export function expenseTHB(e) {
  return toTHB(e.amount, e.currency, e.thbPerEur);
}

export function expenseEUR(e) {
  return toEUR(e.amount, e.currency, e.thbPerEur);
}

// Voce del viaggio: se è pagata vale il tasso del pagamento, se è prevista quello di oggi.
function planRate(item, thbPerEur) {
  return item.paid && item.thbPerEur > 0 ? item.thbPerEur : thbPerEur;
}

export function planTHB(item, thbPerEur) {
  return toTHB(item.amount, item.currency, planRate(item, thbPerEur));
}

export function planEUR(item, thbPerEur) {
  return toEUR(item.amount, item.currency, planRate(item, thbPerEur));
}

// Giorno locale del telefono, "YYYY-MM-DD".
export function dayKey(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function newId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

// `day` è il giorno della spesa (scelto, anche passato o futuro); `ts` resta il momento della registrazione.
export function makeExpense({ amount, currency, category, stage = null, thbPerEur, day = null, now = new Date() }) {
  if (!(amount > 0)) throw new Error('importo non valido');
  if (!CURRENCIES[currency]) throw new Error('valuta non valida');
  return {
    id: newId(),
    ts: now.getTime(),
    day: isISODate(day) ? day : dayKey(now),
    amount: round2(amount),
    currency,
    category: categoryById(category).id,
    stage: stageById(stage) ? stage : null,
    thbPerEur: thbPerEur > 0 ? thbPerEur : null,
  };
}

export function makePlanItem({ kind, label = '', stage = null, amount, currency, paid = false, thbPerEur, now = new Date() }) {
  if (!(amount > 0)) throw new Error('importo non valido');
  if (!CURRENCIES[currency]) throw new Error('valuta non valida');
  if (!planKindById(kind)) throw new Error('voce non valida');
  return {
    id: newId(),
    ts: now.getTime(),
    kind,
    label: String(label).trim().slice(0, 80),
    stage: stageById(stage) ? stage : null,
    amount: round2(amount),
    currency,
    paid: !!paid,
    // il tasso si fissa al pagamento; una voce prevista usa il tasso del giorno
    thbPerEur: paid && thbPerEur > 0 ? thbPerEur : null,
  };
}

// Segna una voce come pagata (fissa il tasso di oggi) o di nuovo prevista.
export function setPlanPaid(item, paid, thbPerEur) {
  return { ...item, paid: !!paid, thbPerEur: paid && thbPerEur > 0 ? thbPerEur : null };
}

// ---- Tastierino ----

const MAX_INT_DIGITS = 7;

// Applica un tasto ("0"-"9", "00", ",", "back", "clear") alla stringa dell'importo.
export function keypadInput(current, key) {
  let s = current || '';
  if (key === 'clear') return '';
  if (key === 'back') return s.slice(0, -1);
  if (key === ',') {
    if (s.includes(',')) return s;
    return (s === '' ? '0' : s) + ',';
  }
  if (!/^\d+$/.test(key)) return s;
  const [intPart, decPart] = s.split(',');
  if (decPart !== undefined) {
    const room = 2 - decPart.length;
    return room > 0 ? s + key.slice(0, room) : s;
  }
  let next = intPart === '0' ? key : intPart + key;
  next = next.replace(/^0+(?=\d)/, '');
  if (next.length > MAX_INT_DIGITS) return s;
  return next;
}

export function parseAmount(s) {
  if (s === null || s === undefined) return 0;
  const str = String(s).trim().replace(/\s/g, '');
  if (!str) return 0;
  // Accetta "1.234,50", "1234,5", "1234.5"
  let norm = str;
  if (norm.includes(',')) norm = norm.replace(/\./g, '').replace(',', '.');
  const n = Number(norm);
  return Number.isFinite(n) && n > 0 ? round2(n) : 0;
}

// ---- Budget del giorno ----

// Quadro del giorno: lo stato si calcola nella valuta in cui è impostato il budget,
// il residuo si mostra in entrambe le valute al tasso attuale.
export function dayBudget(spent, budget, thbPerEur) {
  if (!budget || !(budget.amount > 0)) {
    return { ...budgetStatus(0, 0), remainingTHB: 0, remainingEUR: 0, budgetTHB: 0, budgetEUR: 0 };
  }
  const inEur = budget.currency === 'EUR';
  const st = budgetStatus(inEur ? spent.eur : spent.thb, budget.amount);
  return {
    ...st,
    remainingTHB: toTHB(st.remaining, budget.currency, thbPerEur),
    remainingEUR: toEUR(st.remaining, budget.currency, thbPerEur),
    budgetTHB: toTHB(budget.amount, budget.currency, thbPerEur),
    budgetEUR: toEUR(budget.amount, budget.currency, thbPerEur),
  };
}

// Stato del budget del giorno (speso e budget nella stessa valuta):
// verde fino al 75%, giallo fino al 100%, rosso oltre.
export function budgetStatus(spent, budget) {
  if (!(budget > 0)) return { level: 'none', ratio: 0, remaining: 0 };
  // Spese in un'altra valuta senza tasso: lo stato non si può calcolare.
  if (!Number.isFinite(spent)) return { level: 'none', ratio: 0, remaining: NaN };
  const ratio = spent / budget;
  const remaining = budget - spent;
  if (ratio < 0.75) return { level: 'green', ratio, remaining };
  if (ratio <= 1) return { level: 'yellow', ratio, remaining };
  return { level: 'red', ratio, remaining };
}

export const LEVEL_TEXT = { green: 'Nel budget', yellow: 'Vicino al limite', red: 'Oltre il budget', none: '' };

// ---- Aggregazioni ----

export function expensesOfDay(expenses, day) {
  return expenses.filter((e) => e.day === day);
}

export function totals(expenses) {
  let thb = 0;
  let eur = 0;
  for (const e of expenses) {
    thb += expenseTHB(e);
    eur += expenseEUR(e);
  }
  return { thb, eur, count: expenses.length };
}

export function totalsByCategory(expenses) {
  const map = new Map();
  for (const e of expenses) {
    const cur = map.get(e.category) || { thb: 0, eur: 0, count: 0 };
    cur.thb += expenseTHB(e);
    cur.eur += expenseEUR(e);
    cur.count += 1;
    map.set(e.category, cur);
  }
  return CATEGORIES.filter((c) => map.has(c.id))
    .map((c) => ({ ...c, ...map.get(c.id) }))
    .sort((a, b) => b.thb - a.thb);
}

// Per tappa, nell'ordine del viaggio: spese del giorno più voci del viaggio già pagate con quella tappa.
// Le righe senza tappa (spese della v1, voli internazionali) finiscono in «Senza tappa», in fondo.
export function totalsByStage(expenses, plan = [], thbPerEur = null) {
  const keys = [...STAGES.map((s) => s.id), null];
  const map = new Map(keys.map((k) => [k, { thb: 0, eur: 0, count: 0, dailyTHB: 0, dailyEUR: 0, planTHB: 0, planEUR: 0 }]));
  const key = (id) => (stageById(id) ? id : null);
  for (const e of expenses) {
    const r = map.get(key(e.stage));
    const t = expenseTHB(e);
    const u = expenseEUR(e);
    r.dailyTHB += t;
    r.dailyEUR += u;
    r.count += 1;
  }
  for (const p of plan) {
    if (!p.paid) continue;
    const r = map.get(key(p.stage));
    r.planTHB += planTHB(p, thbPerEur);
    r.planEUR += planEUR(p, thbPerEur);
    r.count += 1;
  }
  return keys
    .map((k) => {
      const r = map.get(k);
      return { id: k, label: stageLabel(k), ...r, thb: r.dailyTHB + r.planTHB, eur: r.dailyEUR + r.planEUR };
    })
    .filter((r) => r.count > 0);
}

// Giorni con almeno una spesa, dal più recente.
export function dailySummary(expenses) {
  const byDay = new Map();
  for (const e of expenses) {
    if (!byDay.has(e.day)) byDay.set(e.day, []);
    byDay.get(e.day).push(e);
  }
  return [...byDay.keys()]
    .sort()
    .reverse()
    .map((day) => {
      const list = byDay.get(day).sort((a, b) => b.ts - a.ts);
      return { day, ...totals(list), categories: totalsByCategory(list), expenses: list };
    });
}

// ---- Budget del viaggio ----

function dateOf(day) {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y, m - 1, d, 12);
}

// Giorni da `a` a `b` (b - a), su giorni locali.
export function daysBetween(a, b) {
  return Math.round((dateOf(b) - dateOf(a)) / 86400000);
}

export function tripDays(trip) {
  return daysBetween(trip.start, trip.end) + 1;
}

export function isValidTrip(trip) {
  return !!trip && isISODate(trip.start) && isISODate(trip.end) && daysBetween(trip.start, trip.end) >= 0;
}

// Giorni del viaggio che restano dopo oggi (oggi conta già nello speso).
export function daysLeft(trip, today) {
  if (today < trip.start) return tripDays(trip);
  if (today >= trip.end) return 0;
  return daysBetween(today, trip.end);
}

export function tripPhase(trip, today) {
  if (today < trip.start) return 'before';
  if (today > trip.end) return 'after';
  return 'during';
}

const sum = (list, fn) => list.reduce((acc, x) => {
  acc.thb += fn(x, 'thb');
  acc.eur += fn(x, 'eur');
  return acc;
}, { thb: 0, eur: 0 });

// Quadro del viaggio:
// - previsto   = tutte le voci (pagate e da pagare) + budget del giorno × giorni del viaggio
// - speso      = voci pagate + spese del giorno fatte nelle date del viaggio, fino a oggi
// - proiezione = speso + voci ancora da pagare + spese già segnate nei giorni che mancano
//                + media al giorno × giorni che mancano senza spese segnate
// La media al giorno è quella delle spese del giorno nelle date del viaggio fino a oggi (sui giorni con spese);
// finché non ce ne sono si usa il budget del giorno. Un giorno futuro con spese segnate (data scelta a mano,
// o un piano) vale quanto le sue spese: non si stima di nuovo con la media.
export function tripSummary({ expenses, plan, budget, trip, today, thbPerEur }) {
  const days = tripDays(trip);
  const left = daysLeft(trip, today);
  const inTrip = expenses.filter((e) => e.day >= trip.start && e.day <= trip.end);
  const done = inTrip.filter((e) => e.day <= today);
  const ahead = inTrip.filter((e) => e.day > today);
  const paid = plan.filter((p) => p.paid);
  const unpaid = plan.filter((p) => !p.paid);
  const planVal = (p, cur) => (cur === 'thb' ? planTHB(p, thbPerEur) : planEUR(p, thbPerEur));
  const expVal = (e, cur) => (cur === 'thb' ? expenseTHB(e) : expenseEUR(e));

  const items = sum(plan, planVal);
  const itemsPaid = sum(paid, planVal);
  const itemsUnpaid = sum(unpaid, planVal);
  const daily = sum(done, expVal);
  const dailyAhead = sum(ahead, expVal);
  const daysWithSpending = new Set(done.map((e) => e.day)).size;
  const daysAhead = new Set(ahead.map((e) => e.day)).size;
  const daysToEstimate = Math.max(0, left - daysAhead);

  const hasBudget = !!budget && budget.amount > 0;
  const budgetDay = hasBudget
    ? { thb: toTHB(budget.amount, budget.currency, thbPerEur), eur: toEUR(budget.amount, budget.currency, thbPerEur) }
    : { thb: 0, eur: 0 };

  let avg;
  let avgSource;
  if (daysWithSpending > 0) {
    avg = { thb: daily.thb / daysWithSpending, eur: daily.eur / daysWithSpending };
    avgSource = 'spese';
  } else if (hasBudget) {
    avg = budgetDay;
    avgSource = 'budget';
  } else {
    avg = { thb: 0, eur: 0 };
    avgSource = 'nessuna';
  }

  const both = (f) => ({ thb: f('thb'), eur: f('eur') });
  const previsto = both((c) => items[c] + budgetDay[c] * days);
  const speso = both((c) => itemsPaid[c] + daily[c]);
  const proiezione = both((c) => speso[c] + itemsUnpaid[c] + dailyAhead[c] + avg[c] * daysToEstimate);

  let level = 'none';
  if (previsto.thb > 0 && Number.isFinite(proiezione.thb)) {
    const ratio = proiezione.thb / previsto.thb;
    level = ratio <= 1 ? 'green' : ratio <= 1.1 ? 'yellow' : 'red';
  }

  const groups = PLAN_GROUPS.map((g) => {
    const list = plan.filter((p) => (planKindById(p.kind) || {}).group === g.id).sort((a, b) => a.ts - b.ts);
    return {
      ...g,
      items: list,
      total: sum(list, planVal),
      paid: sum(list.filter((p) => p.paid), planVal),
      unpaid: sum(list.filter((p) => !p.paid), planVal),
    };
  });

  return {
    days, daysLeft: left, phase: tripPhase(trip, today),
    items, itemsPaid, itemsUnpaid, daily, daysWithSpending, dailyAhead, daysAhead, daysToEstimate, budgetDay, hasBudget,
    avg, avgSource, previsto, speso, proiezione, level, groups,
    outside: expenses.length - inTrip.length,
  };
}

// ---- Tasso di cambio ----

// La data arriva da un servizio esterno: si accetta solo "YYYY-MM-DD", altrimenti la risposta si scarta.
export function isISODate(s) {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
}

// Anche i numeri presi dalla rete si accettano solo se sono già numeri veri: niente stringhe, array o booleani.
export function isPositiveNumber(v) {
  return typeof v === 'number' && Number.isFinite(v) && v > 0;
}

// Risposta di api.frankfurter.dev/v2/rate/thb/eur: euro per 1 baht (circa 0,026).
// Il formato si legge in modo tollerante: { rate } oppure { rates: { EUR } }.
// La data si convalida per intero, senza troncarla: "2026-11-17<script>" o "2026-11-17T00:00Z" si scartano.
export function parseFrankfurterV2(json) {
  const eurPerThb = json ? (json.rate ?? (json.rates && json.rates.EUR)) : undefined;
  const date = json ? json.date : undefined;
  if (!isPositiveNumber(eurPerThb) || !isISODate(date)) throw new Error('risposta frankfurter v2 non valida');
  return { thbPerEur: Math.round((1 / eurPerThb) * 10000) / 10000, date, source: 'frankfurter.dev (BCE)' };
}

// Risposta di api.frankfurter.dev/v1/latest?base=EUR&symbols=THB (stesso formato di api.frankfurter.app)
export function parseFrankfurter(json) {
  const v = json && json.rates && json.rates.THB;
  if (!isPositiveNumber(v) || !isISODate(json.date)) throw new Error('risposta frankfurter non valida');
  return { thbPerEur: v, date: json.date, source: 'frankfurter.app (BCE)' };
}

// Risposta di open.er-api.com/v6/latest/EUR
export function parseErApi(json) {
  const v = json && json.rates && json.rates.THB;
  const t = json && json.time_last_update_unix;
  if (!json || json.result !== 'success' || !isPositiveNumber(v) || !Number.isInteger(t) || t <= 0) {
    throw new Error('risposta er-api non valida');
  }
  const date = dayKey(new Date(t * 1000));
  if (!isISODate(date)) throw new Error('risposta er-api non valida');
  return { thbPerEur: v, date, source: 'open.er-api.com' };
}

// Plausibilità: protegge da risposte strane o errori di battitura nel tasso manuale.
export function isPlausibleRate(thbPerEur) {
  return thbPerEur >= 10 && thbPerEur <= 100;
}

// ---- Formattazione ----

const fmtTHB = new Intl.NumberFormat('it-IT', { maximumFractionDigits: 0, useGrouping: 'always' });
const fmtEUR = new Intl.NumberFormat('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: 'always' });

export function formatTHB(n) {
  if (!Number.isFinite(n)) return '—';
  return '฿' + fmtTHB.format(Math.round(n));
}

export function formatEUR(n) {
  if (!Number.isFinite(n)) return '—';
  return '€' + fmtEUR.format(n);
}

export function formatMoney(amount, currency) {
  if (currency === 'EUR') return formatEUR(amount);
  const hasCents = Math.round(amount * 100) % 100 !== 0;
  return '฿' + new Intl.NumberFormat('it-IT', { minimumFractionDigits: hasCents ? 2 : 0, maximumFractionDigits: 2, useGrouping: 'always' }).format(amount);
}

export function formatRate(thbPerEur) {
  if (!(thbPerEur > 0)) return '—';
  return new Intl.NumberFormat('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: 'always' }).format(thbPerEur);
}

const RELATIVE_DAYS = { '-1': 'Ieri', 0: 'Oggi', 1: 'Domani' };

// "Oggi", "Ieri", "Domani" oppure "Lun 17 nov".
export function formatDay(day, today = dayKey()) {
  const rel = RELATIVE_DAYS[daysBetween(today, day)];
  if (rel) return rel;
  const s = dateOf(day).toLocaleDateString('it-IT', { weekday: 'short', day: 'numeric', month: 'short' });
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// Versione corta per il pulsante della data: "Oggi", "Ieri", "Domani" oppure "17/11".
export function formatDayShort(day, today = dayKey()) {
  return RELATIVE_DAYS[daysBetween(today, day)] || formatDayMonth(day);
}

export function formatShortDate(day) {
  if (!day) return '';
  const [y, m, d] = day.split('-');
  return `${d}/${m}/${y}`;
}

// "28/11" (giorno/mese, senza anno)
export function formatDayMonth(day) {
  return formatShortDate(day).slice(0, 5);
}

// ---- CSV ----

function csvCell(v) {
  const s = String(v);
  return /[";\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

// Valori non calcolabili (riga senza tasso) restano vuoti nel CSV.
const num2 = (n) => (Number.isFinite(n) ? n.toFixed(2).replace('.', ',') : '');

export const CSV_HEADER = [
  'data', 'ora', 'tipo', 'voce', 'tappa', 'stato', 'descrizione',
  'importo', 'valuta', 'importo_thb', 'importo_eur', 'thb_per_eur', 'modalita', 'piano',
];

// CSV per Excel/Numbers in italiano: separatore ";" e virgola decimale.
// Una riga per ogni spesa del giorno (tipo «spesa», voce = categoria) e per ogni voce del viaggio
// (tipo «viaggio», voce = volo, alloggio, traghetto...; stato pagato o previsto).
// Per una spesa `data` è il giorno scelto; `ora` è l'ora di registrazione, solo se registrata quel giorno.
// `modalita` è «reale» o «piano» (con il nome del piano): i piani non vanno sommati al reale.
// Le voci previste si convertono al tasso attuale.
export function toCSV(expenses, plan = [], thbPerEur = null, { mode = 'reale', name = '' } = {}) {
  return CSV_HEADER.map(csvCell).join(';') + '\r\n' + csvRows(expenses, plan, thbPerEur, mode, name);
}

// Tutti i dati in un solo file: prima il reale, poi ogni piano.
export function toCSVAll(real, scenarios = [], thbPerEur = null) {
  return CSV_HEADER.map(csvCell).join(';') + '\r\n'
    + csvRows(real.expenses, real.plan, thbPerEur, 'reale', '')
    + scenarios.map((s) => csvRows(s.expenses, s.plan, thbPerEur, 'piano', s.name)).join('');
}

function csvRows(expenses, plan, thbPerEur, mode, name) {
  const time = (ts) => {
    const t = new Date(ts);
    return String(t.getHours()).padStart(2, '0') + ':' + String(t.getMinutes()).padStart(2, '0');
  };
  const rows = [
    ...expenses.map((e) => ({
      day: e.day,
      ts: e.ts,
      cells: [
        e.day, dayKey(new Date(e.ts)) === e.day ? time(e.ts) : '', 'spesa', categoryById(e.category).label,
        stageById(e.stage) ? stageLabel(e.stage) : '', 'pagato', '',
        num2(e.amount), e.currency, num2(expenseTHB(e)), num2(expenseEUR(e)), num2(e.thbPerEur), mode, name,
      ],
    })),
    ...plan.map((p) => ({
      day: dayKey(new Date(p.ts)),
      ts: p.ts,
      cells: [
        dayKey(new Date(p.ts)), time(p.ts), 'viaggio', (planKindById(p.kind) || { label: p.kind }).label,
        stageById(p.stage) ? stageLabel(p.stage) : '', p.paid ? 'pagato' : 'previsto', p.label || '',
        num2(p.amount), p.currency, num2(planTHB(p, thbPerEur)), num2(planEUR(p, thbPerEur)), num2(planRate(p, thbPerEur)), mode, name,
      ],
    })),
  ].sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : a.ts - b.ts));
  return rows.map((r) => r.cells.map(csvCell).join(';') + '\r\n').join('');
}

// ---- Pianificazione (viaggi ipotetici) ----

// Un piano ha dati suoi (spese, voci del viaggio, budget, date, tappa) e non si somma mai al reale.
// Tasso di cambio e valuta di inserimento restano comuni.
export const SCENARIO_NAME_MAX = 40;

export function cleanScenarioName(name) {
  return String(name ?? '').replace(/\s+/g, ' ').trim().slice(0, SCENARIO_NAME_MAX);
}

// "Piano 1", "Piano 2"... il primo nome libero.
export function nextScenarioName(list, base = 'Piano') {
  const used = new Set(list.map((s) => s.name));
  for (let i = 1; ; i++) if (!used.has(`${base} ${i}`)) return `${base} ${i}`;
}

// Piano vuoto (con le date indicate) oppure copia completa dei dati reali (`copyFrom`): la copia è profonda,
// quindi cambiare il piano non tocca mai il reale.
export function makeScenario({ name, copyFrom = null, trip = DEFAULT_TRIP, now = Date.now() }) {
  const src = copyFrom ? JSON.parse(JSON.stringify(copyFrom)) : null;
  const settings = src ? src.settings || {} : {};
  return {
    id: newId(),
    name: cleanScenarioName(name) || 'Piano',
    createdAt: now,
    expenses: src ? src.expenses || [] : [],
    plan: src ? src.plan || [] : [],
    settings: {
      budget: settings.budget || null,
      trip: isValidTrip(settings.trip) ? { ...settings.trip } : { ...trip },
      stage: stageById(settings.stage) ? settings.stage : STAGES[0].id,
    },
  };
}

// ---- Migrazione dei dati salvati ----

// v1 (1.0–1.1.2): cdv.expenses = [{ id, ts, day, amount, currency, category, thbPerEur }], cdv.settings.
// v2 (2.0.0): le spese hanno anche `stage`; nuove impostazioni (tappa attuale, date del viaggio) e nuove voci (cdv.plan).
// v3 (2.1.0): `day` di una spesa si può scegliere (era sempre il giorno di registrazione: nessun cambio ai dati);
//             i piani ipotetici stanno a parte in cdv.piani, ognuno con spese, voci e impostazioni sue.
// La migrazione aggiunge e corregge, non toglie: i campi sconosciuti restano, le righe illeggibili si contano
// (e restano nella copia di sicurezza che l'app salva prima di migrare). Rieseguirla non cambia niente.
export const SCHEMA_VERSION = 3;

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const toNum = (v) => (typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN);

function migrateRow(raw, now, seen, extra) {
  if (!isObj(raw)) return null;
  const amount = toNum(raw.amount);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  let ts = toNum(raw.ts);
  if (!Number.isFinite(ts) || ts <= 0) ts = isISODate(raw.day) ? dateOf(raw.day).getTime() : now;
  let id = typeof raw.id === 'string' && raw.id ? raw.id : newId();
  while (seen.has(id)) id += '-' + Math.random().toString(36).slice(2, 5);
  seen.add(id);
  const rate = toNum(raw.thbPerEur);
  return {
    ...raw,
    id,
    ts,
    amount: round2(amount),
    currency: raw.currency === 'EUR' ? 'EUR' : 'THB',
    stage: stageById(raw.stage) ? raw.stage : null,
    thbPerEur: rate > 0 ? rate : null,
    ...extra(raw, ts),
  };
}

// Spese e voci di un insieme di dati (il reale o un piano). Gli id sono unici dentro l'insieme.
function migrateLists(expenses, plan, now, report) {
  const seen = new Set();
  const outExpenses = [];
  for (const raw of Array.isArray(expenses) ? expenses : []) {
    const e = migrateRow(raw, now, seen, (r, ts) => ({
      day: isISODate(r.day) ? r.day : dayKey(new Date(ts)),
      category: categoryById(r.category).id,
    }));
    if (e) outExpenses.push(e);
    else report.dropped += 1;
  }

  const outPlan = [];
  for (const raw of Array.isArray(plan) ? plan : []) {
    const p = isObj(raw) && planKindById(raw.kind)
      ? migrateRow(raw, now, seen, (r) => ({ label: typeof r.label === 'string' ? r.label.slice(0, 80) : '', paid: r.paid === true }))
      : null;
    if (p) {
      if (!p.paid) p.thbPerEur = null;
      outPlan.push(p);
    } else report.dropped += 1;
  }
  return { expenses: outExpenses, plan: outPlan };
}

function migrateBudget(b) {
  const amount = isObj(b) ? toNum(b.amount) : NaN;
  return amount > 0 ? { amount: round2(amount), currency: b.currency === 'EUR' ? 'EUR' : 'THB' } : null;
}

// Impostazioni proprie di un insieme di dati: budget del giorno, date del viaggio, tappa attuale.
function migrateOwnSettings(s, defaultTrip) {
  return {
    ...s,
    budget: migrateBudget(s.budget),
    stage: stageById(s.stage) ? s.stage : STAGES[0].id,
    trip: isValidTrip(s.trip) ? { start: s.trip.start, end: s.trip.end } : { ...defaultTrip },
  };
}

export function migrateData({ schema, expenses, settings, plan, scenarios } = {}, now = Date.now()) {
  const fromSchema = Number(schema) >= 1 ? Number(schema) : expenses || settings ? 1 : 0;
  const report = { from: fromSchema, to: SCHEMA_VERSION, expenses: 0, plan: 0, scenarios: 0, dropped: 0 };

  const real = migrateLists(expenses, plan, now, report);

  const s = isObj(settings) ? settings : {};
  let rate = isObj(s.rate) ? { ...s.rate } : null;
  // Le prime versioni di prova salvavano un tasso indicativo: non è un tasso vero.
  if (!rate || rate.source === 'default' || !(toNum(rate.thbPerEur) > 0)) rate = { ...NO_RATE, mode: 'auto', fetchedAt: 0 };
  else rate.thbPerEur = toNum(rate.thbPerEur);

  const outSettings = {
    ...migrateOwnSettings(s, DEFAULT_TRIP),
    inputCurrency: s.inputCurrency === 'EUR' ? 'EUR' : 'THB',
    rate,
  };

  // Piani: ognuno con i suoi dati; un piano illeggibile si conta tra le righe scartate.
  const outScenarios = [];
  const ids = new Set();
  for (const raw of Array.isArray(scenarios) ? scenarios : []) {
    if (!isObj(raw)) {
      report.dropped += 1;
      continue;
    }
    let id = typeof raw.id === 'string' && raw.id ? raw.id : newId();
    while (ids.has(id)) id += '-' + Math.random().toString(36).slice(2, 5);
    ids.add(id);
    const lists = migrateLists(raw.expenses, raw.plan, now, report);
    const created = toNum(raw.createdAt);
    outScenarios.push({
      ...raw,
      id,
      name: cleanScenarioName(raw.name) || nextScenarioName(outScenarios),
      createdAt: created > 0 ? created : now,
      expenses: lists.expenses,
      plan: lists.plan,
      settings: migrateOwnSettings(isObj(raw.settings) ? raw.settings : {}, outSettings.trip),
    });
  }

  report.expenses = real.expenses.length;
  report.plan = real.plan.length;
  report.scenarios = outScenarios.length;
  return { schema: SCHEMA_VERSION, expenses: real.expenses, settings: outSettings, plan: real.plan, scenarios: outScenarios, report };
}

// Mostra la stringa del tastierino con i separatori delle migliaia: "1234,5" -> "1.234,5".
export function formatKeypad(s) {
  if (!s) return '0';
  const [i, d] = s.split(',');
  const grouped = i.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return d === undefined ? grouped : grouped + ',' + d;
}

// Importo in forma modificabile per i campi di testo: 120 -> "120", 3.5 -> "3,50".
export function amountToInput(n) {
  return Number.isInteger(n) ? String(n) : n.toFixed(2).replace('.', ',');
}
