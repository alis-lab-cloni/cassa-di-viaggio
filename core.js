// Logica pura della Cassa di viaggio: niente DOM, niente rete. Testata con `node --test`.

export const CATEGORIES = [
  { id: 'cibo', label: 'Cibo', emoji: '🍜' },
  { id: 'trasporti', label: 'Trasporti', emoji: '🛺' },
  { id: 'alloggio', label: 'Alloggio', emoji: '🏝️' },
  { id: 'attivita', label: 'Attività', emoji: '🐘' },
  { id: 'spesa', label: 'Spesa', emoji: '🛍️' },
  { id: 'massaggi', label: 'Massaggi', emoji: '💆' },
  { id: 'altro', label: 'Altro', emoji: '✨' },
];

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

// Spese registrate quando non c'era ancora un tasso: ricevono il primo tasso vero.
// Restituisce quante spese sono state completate.
export function fillMissingRate(expenses, thbPerEur) {
  if (!(thbPerEur > 0)) return 0;
  let n = 0;
  for (const e of expenses) {
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

export function makeExpense({ amount, currency, category, thbPerEur, now = new Date() }) {
  if (!(amount > 0)) throw new Error('importo non valido');
  if (!CURRENCIES[currency]) throw new Error('valuta non valida');
  return {
    id: newId(),
    ts: now.getTime(),
    day: dayKey(now),
    amount: round2(amount),
    currency,
    category: categoryById(category).id,
    thbPerEur: thbPerEur > 0 ? thbPerEur : null,
  };
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

// ---- Budget ----

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
  if (!(budget > 0)) {
    return { level: 'none', ratio: 0, remaining: 0, face: '🙂' };
  }
  // Spese in un'altra valuta senza tasso: lo stato non si può calcolare.
  if (!Number.isFinite(spent)) return { level: 'none', ratio: 0, remaining: NaN, face: '🤔' };
  const ratio = spent / budget;
  const remaining = budget - spent;
  if (ratio < 0.75) return { level: 'green', ratio, remaining, face: ratio < 0.4 ? '😄' : '🙂' };
  if (ratio <= 1) return { level: 'yellow', ratio, remaining, face: '😬' };
  return { level: 'red', ratio, remaining, face: '🥵' };
}

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

export function formatDay(day, today = dayKey()) {
  if (day === today) return 'Oggi';
  const [y, m, d] = day.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  if (day === dayKey(yesterday) && today === dayKey()) return 'Ieri';
  const s = date.toLocaleDateString('it-IT', { weekday: 'short', day: 'numeric', month: 'short' });
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function formatShortDate(day) {
  if (!day) return '';
  const [y, m, d] = day.split('-');
  return `${d}/${m}/${y}`;
}

// ---- CSV ----

function csvCell(v) {
  const s = String(v);
  return /[";\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

// Valori non calcolabili (spesa senza tasso) restano vuoti nel CSV.
const num2 = (n) => (Number.isFinite(n) ? n.toFixed(2).replace('.', ',') : '');

// CSV per Excel/Numbers in italiano: separatore ";" e virgola decimale.
export function toCSV(expenses) {
  const header = ['data', 'ora', 'categoria', 'importo', 'valuta', 'importo_thb', 'importo_eur', 'thb_per_eur'];
  const rows = [...expenses]
    .sort((a, b) => a.ts - b.ts)
    .map((e) => {
      const t = new Date(e.ts);
      const ora = String(t.getHours()).padStart(2, '0') + ':' + String(t.getMinutes()).padStart(2, '0');
      return [
        e.day,
        ora,
        categoryById(e.category).label,
        num2(e.amount),
        e.currency,
        num2(expenseTHB(e)),
        num2(expenseEUR(e)),
        num2(e.thbPerEur),
      ];
    });
  return [header, ...rows].map((r) => r.map(csvCell).join(';')).join('\r\n') + '\r\n';
}

// ---- Feedback giocoso ----

const CHEERS = {
  cibo: ['Gnam! 🍜', 'Pad thai approvato!', 'Buon appetito! 🥢'],
  trasporti: ['Si parte! 🛺', 'Brum brum!', 'In viaggio! 🚤'],
  alloggio: ['Nanna assicurata 🛏️', 'Casa dolce casa 🏝️'],
  attivita: ['Avventura! 🐘', 'Che giornata! 🌴'],
  spesa: ['Shopping! 🛍️', 'Affare fatto!'],
  massaggi: ['Relax totale 💆', 'Ahhh… 😌'],
  altro: ['Segnato! ✨', 'Fatto! 👍'],
};

export function cheerFor(category, rnd = Math.random) {
  const list = CHEERS[category] || CHEERS.altro;
  return list[Math.floor(rnd() * list.length) % list.length];
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
