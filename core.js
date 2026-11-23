// Logica pura della Cassa di viaggio: niente DOM, niente rete. Testata con `node --test`.
// Nessun viaggio è preimpostato: destinazione, valute, date e tappe le sceglie l'utente.

export const CATEGORIES = [
  { id: 'cibo', label: 'Cibo' },
  { id: 'trasporti', label: 'Trasporti' },
  { id: 'alloggio', label: 'Alloggio' },
  { id: 'attivita', label: 'Attività' },
  { id: 'spesa', label: 'Spesa' },
  { id: 'massaggi', label: 'Benessere' }, // id storico: le spese salvate restano in questa categoria
  { id: 'altro', label: 'Altro' },
];

export const NO_STAGE_LABEL = 'Senza tappa';
// Avviso per una spesa o voce senza tappa quando il viaggio ha più tappe tra cui scegliere.
export const NO_DEST_LABEL = 'Destinazione non indicata';
// Riga del riepilogo senza tappe né destinazione del viaggio.
export const WHOLE_TRIP_LABEL = 'Tutto il viaggio';

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
  { id: 'treno', label: 'Treno', group: 'spostamenti' },
  { id: 'traghetto', label: 'Traghetto', group: 'spostamenti' },
  { id: 'bus', label: 'Bus', group: 'spostamenti' },
  { id: 'taxi', label: 'Taxi / transfer', group: 'spostamenti' },
];

// ---- Valute ----

// Valute in corso (ISO 4217, senza fondi, metalli e codici di prova). L'utente sceglie la valuta locale
// (quella del posto) e quella di casa: possono anche coincidere (viaggio nel proprio paese o nella stessa area).
export const CURRENCY_CODES = [
  'AED', 'AFN', 'ALL', 'AMD', 'AOA', 'ARS', 'AUD', 'AWG', 'AZN', 'BAM', 'BBD', 'BDT', 'BHD', 'BIF', 'BMD', 'BND',
  'BOB', 'BRL', 'BSD', 'BTN', 'BWP', 'BYN', 'BZD', 'CAD', 'CDF', 'CHF', 'CLP', 'CNY', 'COP', 'CRC', 'CUP', 'CVE',
  'CZK', 'DJF', 'DKK', 'DOP', 'DZD', 'EGP', 'ERN', 'ETB', 'EUR', 'FJD', 'FKP', 'GBP', 'GEL', 'GHS', 'GIP', 'GMD',
  'GNF', 'GTQ', 'GYD', 'HKD', 'HNL', 'HTG', 'HUF', 'IDR', 'ILS', 'INR', 'IQD', 'IRR', 'ISK', 'JMD', 'JOD', 'JPY',
  'KES', 'KGS', 'KHR', 'KMF', 'KPW', 'KRW', 'KWD', 'KYD', 'KZT', 'LAK', 'LBP', 'LKR', 'LRD', 'LSL', 'LYD', 'MAD',
  'MDL', 'MGA', 'MKD', 'MMK', 'MNT', 'MOP', 'MRU', 'MUR', 'MVR', 'MWK', 'MXN', 'MYR', 'MZN', 'NAD', 'NGN', 'NIO',
  'NOK', 'NPR', 'NZD', 'OMR', 'PAB', 'PEN', 'PGK', 'PHP', 'PKR', 'PLN', 'PYG', 'QAR', 'RON', 'RSD', 'RUB', 'RWF',
  'SAR', 'SBD', 'SCR', 'SDG', 'SEK', 'SGD', 'SHP', 'SLE', 'SOS', 'SRD', 'SSP', 'STN', 'SVC', 'SYP', 'SZL', 'THB',
  'TJS', 'TMT', 'TND', 'TOP', 'TRY', 'TTD', 'TWD', 'TZS', 'UAH', 'UGX', 'USD', 'UYU', 'UZS', 'VED', 'VES', 'VND',
  'VUV', 'WST', 'XAF', 'XCD', 'XCG', 'XOF', 'XPF', 'YER', 'ZAR', 'ZMW', 'ZWG',
];

const CODE_SET = new Set(CURRENCY_CODES);

export function isCurrency(code) {
  return typeof code === 'string' && CODE_SET.has(code);
}

// { local, home }: entrambe valute valide.
export function isValidCurrencies(c) {
  return !!c && isCurrency(c.local) && isCurrency(c.home);
}

let namesIt = null;
export function currencyName(code) {
  try {
    namesIt = namesIt || new Intl.DisplayNames(['it'], { type: 'currency' });
    const n = namesIt.of(code);
    return n && n !== code ? n : code;
  } catch {
    return code;
  }
}

// Elenco per la scelta della valuta, in ordine di nome.
export function currencyOptions() {
  return CURRENCY_CODES.map((code) => ({ code, name: currencyName(code) }))
    .sort((a, b) => a.name.localeCompare(b.name, 'it'));
}

const fold = (s) => String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();

// Ricerca nell'elenco statico per codice o nome ("usd", "dollaro", "yen", "dong"), senza rete.
// Prima il codice esatto, poi i codici che iniziano così, poi i nomi che iniziano così, poi il resto.
export function searchCurrencies(query) {
  const q = fold(query);
  const all = currencyOptions();
  if (!q) return all;
  const rank = (o) => {
    const code = o.code.toLowerCase();
    const name = fold(o.name);
    if (code === q) return 0;
    if (code.startsWith(q)) return 1;
    if (name.startsWith(q) || name.split(/[\s-]+/).some((w) => w.startsWith(q))) return 2;
    if (name.includes(q)) return 3;
    return -1;
  };
  return all.map((o) => ({ o, r: rank(o) })).filter((x) => x.r >= 0).sort((a, b) => a.r - b.r).map((x) => x.o);
}

// Valute del viaggio: la locale, quella di riferimento (di casa) e le altre aggiunte dall'utente, senza doppioni.
export function tripCurrencies(currencies, extra = []) {
  if (!isValidCurrencies(currencies)) return [];
  return [currencies.local, currencies.home, ...(Array.isArray(extra) ? extra : [])]
    .filter((c, i, a) => isCurrency(c) && a.indexOf(c) === i);
}

// Una valuta «in più»: né la locale né quella di riferimento.
export const isExtraCurrency = (code, fx) => code !== fx.local && code !== fx.home;

function symbolOf(code, display) {
  try {
    const p = new Intl.NumberFormat('it-IT', { style: 'currency', currency: code, currencyDisplay: display })
      .formatToParts(1).find((x) => x.type === 'currency');
    return p ? p.value : code;
  } catch {
    return code;
  }
}

// Simboli brevi delle due valute del viaggio. Se si confondono (dollaro e dollaro, yen e yuan) si usano
// i simboli lunghi (US$, CA$) e, se non basta, i codici.
export function currencySymbols(local, home) {
  const s = symbolsOf([local, home]);
  return { local: s[local], home: s[home] };
}

// Simboli di tutte le valute del viaggio, con la stessa regola: solo quelle che si confondono passano al simbolo
// lungo e poi al codice.
export function symbolsOf(codes) {
  const list = codes.filter((c, i, a) => a.indexOf(c) === i);
  const out = Object.fromEntries(list.map((c) => [c, symbolOf(c, 'narrowSymbol')]));
  for (const next of [(c) => symbolOf(c, 'symbol'), (c) => c]) {
    const clash = list.filter((c) => list.some((d) => d !== c && out[d] === out[c]));
    for (const c of clash) out[c] = next(c);
  }
  return out;
}

// Decimali della valuta (yen 0, euro 2, dinaro kuwaitiano 3).
export function currencyDigits(code) {
  try {
    return new Intl.NumberFormat('it-IT', { style: 'currency', currency: code }).resolvedOptions().maximumFractionDigits;
  } catch {
    return 2;
  }
}

// Importo arrotondato ai decimali della valuta (yen 0, euro 2, dinaro kuwaitiano 3).
export function roundAmount(n, code) {
  const p = 10 ** currencyDigits(code);
  return Math.round(n * p) / p;
}

// ---- Cambio e conversioni ----

// fx = { local, home, rate, extra, rates }: `rate` è quante unità della valuta locale vale 1 unità della valuta
// di casa (la valuta di riferimento). Le altre valute del viaggio (`extra`) hanno ognuna il suo tasso in `rates`:
// quante unità di quella valuta vale 1 unità della valuta di riferimento.
// Ogni spesa conserva importo, valuta e il tasso del momento (`rate`, e `xrate` per le altre valute):
// i totali dei giorni passati non cambiano quando il tasso si aggiorna.

// Nessun tasso ancora: non si inventano conversioni finché non arriva un tasso vero o uno manuale.
export const NO_RATE = { value: null, pair: null, date: null, source: 'nessuno' };

export const pairOf = (c) => `${c.local}/${c.home}`;

// Tasso valido per le valute del viaggio: con la stessa valuta vale sempre 1.
export function currentRate(currencies, r) {
  if (!isValidCurrencies(currencies)) return null;
  if (currencies.local === currencies.home) return 1;
  return r && r.value > 0 && r.pair === pairOf(currencies) ? r.value : null;
}

// Tasso attuale di un'altra valuta del viaggio: vale solo se è riferito alla valuta di riferimento di adesso.
export function currentXRate(currencies, rates, code) {
  if (!isValidCurrencies(currencies) || !isCurrency(code)) return null;
  if (code === currencies.home) return 1;
  const r = rates && rates[code];
  return r && r.value > 0 && r.base === currencies.home ? r.value : null;
}

// Tassi attuali delle altre valute, per fx.rates.
export function extraRates(currencies, extra, rates) {
  const out = {};
  for (const c of extra || []) out[c] = currentXRate(currencies, rates, c);
  return out;
}

// Importo convertito nella valuta locale e in quella di riferimento. Senza tasso la conversione è NaN
// (si mostra «—»), mai un valore inventato. `xrate` serve solo per le altre valute.
export function convert(amount, currency, rate, fx, xrate) {
  const same = fx.local === fx.home;
  if (currency === fx.local) return { local: amount, home: same ? amount : rate > 0 ? amount / rate : NaN };
  if (currency === fx.home) return { local: rate > 0 ? amount * rate : NaN, home: amount };
  const home = xrate > 0 ? amount / xrate : NaN;
  return { local: same ? home : rate > 0 ? home * rate : NaN, home };
}

// Righe in un'altra valuta registrate senza il suo tasso: ricevono il primo tasso scritto per quella valuta.
export function fillMissingXRate(list, code, xrate) {
  if (!(xrate > 0)) return 0;
  let n = 0;
  for (const e of list) {
    if (e.currency !== code || e.paid === false) continue;
    if (!(e.xrate > 0)) {
      e.xrate = xrate;
      n += 1;
    }
  }
  return n;
}

// Spese (e voci già pagate) registrate quando non c'era ancora un tasso: ricevono il primo tasso vero.
// Le voci ancora da pagare non hanno un tasso proprio: usano sempre quello attuale.
// Restituisce quante righe sono state completate.
export function fillMissingRate(list, rate) {
  if (!(rate > 0)) return 0;
  let n = 0;
  for (const e of list) {
    if (e.paid === false) continue;
    if (!(e.rate > 0)) {
      e.rate = rate;
      n += 1;
    }
  }
  return n;
}

export function expenseValue(e, fx) {
  return convert(e.amount, e.currency, e.rate, fx, e.xrate);
}

// Voce del viaggio: se è pagata vale il tasso del pagamento, se è prevista quello di oggi.
function planRate(item, fx) {
  return item.paid && item.rate > 0 ? item.rate : fx.rate;
}

export function planXRate(item, fx) {
  return item.paid && item.xrate > 0 ? item.xrate : fx.rates ? fx.rates[item.currency] : undefined;
}

export function planValue(item, fx) {
  return convert(item.amount, item.currency, planRate(item, fx), fx, planXRate(item, fx));
}

// ---- Tappe (le sceglie l'utente, anche nessuna) ----

export const STAGE_NAME_MAX = 40;

export function cleanStageName(name) {
  return String(name ?? '').replace(/\s+/g, ' ').trim().slice(0, STAGE_NAME_MAX);
}

// Una tappa ha un nome e, se l'utente le indica, le date (estremi inclusi).
export function makeStage({ name, start = null, end = null }) {
  const n = cleanStageName(name);
  if (!n) throw new Error('nome non valido');
  const s = isISODate(start) ? start : null;
  const e = isISODate(end) ? end : null;
  if (s && e && e < s) throw new Error('date non valide');
  return { id: 't' + newId(), name: n, start: s, end: e };
}

// In ordine di viaggio: prima quelle con la data di inizio, poi le altre nell'ordine in cui sono state aggiunte.
export function sortStages(stages) {
  return stages
    .map((s, i) => ({ s, i }))
    .sort((a, b) => {
      const x = a.s.start || '9999';
      const y = b.s.start || '9999';
      return x < y ? -1 : x > y ? 1 : a.i - b.i;
    })
    .map((x) => x.s);
}

export function stageById(stages, id) {
  return (id && stages.find((s) => s.id === id)) || null;
}

export function stageLabel(stages, id) {
  const s = stageById(stages, id);
  return s ? s.name : NO_STAGE_LABEL;
}

// Destinazione di una spesa o voce, come la mostrano Viaggio e Riepilogo. `missing` = avviso da mostrare.
// - con la sua tappa: il nome della tappa;
// - una sola tappa nel viaggio: quella (le righe si assegnano da sole, vedi assignSingleStage);
// - nessuna tappa: la destinazione del viaggio, se c'è; non c'è niente da scegliere, quindi nessun avviso;
// - più tappe e nessuna scelta (o tappa eliminata): «Destinazione non indicata», perché si può indicare.
export function destinationOf(stages, id, tripDestination = '') {
  const s = stageById(stages, id);
  if (s) return { label: s.name, missing: false };
  if (stages.length === 1) return { label: stages[0].name, missing: false };
  if (!stages.length) return { label: tripDestination || '', missing: false };
  return { label: NO_DEST_LABEL, missing: true };
}

// Con una sola tappa ogni spesa o voce senza tappa (o con una tappa eliminata) va su quella.
// Restituisce liste nuove solo se cambia qualcosa; `count` = righe assegnate.
export function assignSingleStage(expenses, plan, stages) {
  if (stages.length !== 1) return { expenses, plan, count: 0 };
  const id = stages[0].id;
  let count = 0;
  const fix = (r) => {
    if (r.stage === id) return r;
    count += 1;
    return { ...r, stage: id };
  };
  const e = expenses.map(fix);
  const p = plan.map(fix);
  return count ? { expenses: e, plan: p, count } : { expenses, plan, count: 0 };
}

// La tappa i cui giorni comprendono `day` (la prima, se si sovrappongono).
export function stageOfDay(stages, day) {
  return sortStages(stages).find((s) => s.start && s.end && day >= s.start && day <= s.end) || null;
}

export function categoryById(id) {
  return CATEGORIES.find((c) => c.id === id) || CATEGORIES[CATEGORIES.length - 1];
}

export function planKindById(id) {
  return PLAN_KINDS.find((k) => k.id === id) || null;
}

const round2 = (n) => Math.round(n * 100) / 100;

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

const stageId = (s) => (typeof s === 'string' && s ? s : null);

// `day` è il giorno della spesa (scelto, anche passato o futuro); `ts` resta il momento della registrazione.
// `xrate` (tasso della sua valuta verso quella di riferimento) si passa solo per una spesa in un'altra valuta.
export function makeExpense({ amount, currency, category, stage = null, rate, xrate, day = null, now = new Date() }) {
  if (!isCurrency(currency)) throw new Error('valuta non valida');
  const value = roundAmount(Number(amount), currency);
  if (!(value > 0)) throw new Error('importo non valido');
  const e = {
    id: newId(),
    ts: now.getTime(),
    day: isISODate(day) ? day : dayKey(now),
    amount: value,
    currency,
    category: categoryById(category).id,
    stage: stageId(stage),
    rate: rate > 0 ? rate : null,
  };
  if (xrate !== undefined) e.xrate = xrate > 0 ? xrate : null;
  return e;
}

export function makePlanItem({ kind, label = '', stage = null, amount, currency, paid = false, rate, xrate, now = new Date() }) {
  if (!isCurrency(currency)) throw new Error('valuta non valida');
  if (!planKindById(kind)) throw new Error('voce non valida');
  const value = roundAmount(Number(amount), currency);
  if (!(value > 0)) throw new Error('importo non valido');
  return setPlanPaid({
    id: newId(),
    ts: now.getTime(),
    kind,
    label: String(label).trim().slice(0, 80),
    stage: stageId(stage),
    amount: value,
    currency,
  }, paid, rate, xrate);
}

// Segna una voce come pagata (fissa il tasso di oggi) o di nuovo prevista: il tasso si fissa al pagamento,
// una voce prevista usa il tasso del giorno. `xrate` solo per una voce in un'altra valuta (senza, il campo non c'è).
export function setPlanPaid(item, paid, rate, xrate) {
  const { xrate: _old, ...rest } = item;
  const next = { ...rest, paid: !!paid, rate: paid && rate > 0 ? rate : null };
  if (xrate !== undefined) next.xrate = paid && xrate > 0 ? xrate : null;
  return next;
}

// ---- Tastierino ----

const MAX_INT_DIGITS = 7;

// Applica un tasto ("0"-"9", "00", ",", "back", "clear") alla stringa dell'importo.
// `digits` = decimali della valuta: con lo yen (0) la virgola non serve, con il dinaro kuwaitiano se ne scrivono 3.
export function keypadInput(current, key, digits = 2) {
  let s = current || '';
  if (key === 'clear') return '';
  if (key === 'back') return s.slice(0, -1);
  if (key === ',') {
    if (s.includes(',') || digits === 0) return s;
    return (s === '' ? '0' : s) + ',';
  }
  if (!/^\d+$/.test(key)) return s;
  const [intPart, decPart] = s.split(',');
  if (decPart !== undefined) {
    const room = digits - decPart.length;
    return room > 0 ? s + key.slice(0, room) : s;
  }
  let next = intPart === '0' ? key : intPart + key;
  next = next.replace(/^0+(?=\d)/, '');
  if (next.length > MAX_INT_DIGITS) return s;
  return next;
}

// Numero scritto a mano: "1.234,50", "1234,5", "1234.5", "1.400" (punto delle migliaia, all'italiana: 1400).
// Nessun arrotondamento (serve anche per i tassi).
export function parseDecimal(s) {
  if (s === null || s === undefined) return 0;
  const str = String(s).trim().replace(/\s/g, '');
  if (!str) return 0;
  let norm = str;
  if (norm.includes(',')) norm = norm.replace(/\./g, '').replace(',', '.');
  else if (/^[1-9]\d{0,2}(\.\d{3})+$/.test(norm)) norm = norm.replace(/\./g, '');
  const n = Number(norm);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

// Importo scritto: arrotondato ai decimali della valuta, se indicata (senza valuta a 2 decimali).
export function parseAmount(s, currency) {
  const n = parseDecimal(s);
  return currency ? roundAmount(n, currency) : round2(n);
}

// Stringa del tastierino adattata ai decimali di un'altra valuta (es. "12,50" passando allo yen → "12").
export function fitKeypad(s, digits) {
  if (!s || !s.includes(',')) return s || '';
  const [i, d] = s.split(',');
  return digits === 0 ? i : `${i},${d.slice(0, digits)}`;
}

// ---- Importi rapidi ----

// Serie 1-2-5: 1, 2, 5, 10, 20, 50, 100...
const SERIES = [];
for (let p = 1; p <= 1e6; p *= 10) SERIES.push(p, 2 * p, 5 * p);

function niceIndex(x) {
  let best = 0;
  for (let i = 1; i < SERIES.length; i++) {
    if (Math.abs(Math.log10(SERIES[i] / x)) < Math.abs(Math.log10(SERIES[best] / x))) best = i;
  }
  return Math.min(best, SERIES.length - 5);
}

export const QUICK_FALLBACK = [5, 10, 20, 50, 100];

// Importi rapidi sopra il tastierino (un tocco = importo inserito), sensati per qualsiasi valuta:
// - con il budget del giorno: circa l'1%, 2,5%, 5%, 10% e 25% del budget nella valuta locale
//   (es. budget 2.000 → 20, 50, 100, 200, 500); nella valuta di casa dieci volte tanto (prenotazioni, tour);
// - senza budget ma con il cambio: a partire da circa mezza unità di casa (es. 1 € ≈ 160 ¥ → 100, 200, 500...);
// - senza nessuna delle due informazioni: 5, 10, 20, 50, 100.
export function quickAmounts(currency, fx, budget = null) {
  if (isExtraCurrency(currency, fx)) return quickExtra(currency, fx, budget);
  const side = currency === fx.local ? 'local' : 'home';
  const factor = side === 'home' && fx.local !== fx.home ? 0.1 : 0.01;
  const b = budget && budget.amount > 0 ? convert(budget.amount, budget.currency, fx.rate, fx)[side] : NaN;
  let anchor = NaN;
  if (Number.isFinite(b) && b > 0) anchor = b * factor;
  else if (side === 'local' && (fx.rate > 0 || fx.local === fx.home)) anchor = 0.5 * (fx.local === fx.home ? 1 : fx.rate);
  if (!(anchor > 0)) return [...QUICK_FALLBACK];
  const i = niceIndex(anchor);
  return SERIES.slice(i, i + 5);
}

// In un'altra valuta: come per la valuta locale (circa l'1% del budget, oppure mezza unità di riferimento),
// con il tasso di quella valuta; senza tasso 5, 10, 20, 50, 100.
function quickExtra(currency, fx, budget) {
  const x = fx.rates ? fx.rates[currency] : null;
  if (!(x > 0)) return [...QUICK_FALLBACK];
  const b = budget && budget.amount > 0 ? convert(budget.amount, budget.currency, fx.rate, fx).home * x : NaN;
  const anchor = Number.isFinite(b) && b > 0 ? b * 0.01 : 0.5 * x;
  const i = niceIndex(anchor);
  return SERIES.slice(i, i + 5);
}

// ---- Budget del giorno ----

// Quadro del giorno: lo stato si calcola nella valuta in cui è impostato il budget,
// il residuo si mostra in entrambe le valute al tasso attuale.
export function dayBudget(spent, budget, fx) {
  if (!budget || !(budget.amount > 0)) {
    return { ...budgetStatus(0, 0), remainingLocal: 0, remainingHome: 0 };
  }
  const st = budgetStatus(spentIn(spent, budget.currency, fx), budget.amount);
  const rem = convert(st.remaining, budget.currency, fx.rate, fx);
  return { ...st, remainingLocal: rem.local, remainingHome: rem.home };
}

// Speso nella valuta del budget.
export function spentIn(spent, currency, fx) {
  if (currency === fx.local) return spent.local;
  if (currency === fx.home) return spent.home;
  return NaN;
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

export function totals(expenses, fx) {
  let local = 0;
  let home = 0;
  for (const e of expenses) {
    const v = expenseValue(e, fx);
    local += v.local;
    home += v.home;
  }
  return { local, home, count: expenses.length };
}

export function totalsByCategory(expenses, fx) {
  const map = new Map();
  for (const e of expenses) {
    const cur = map.get(e.category) || { local: 0, home: 0, count: 0 };
    const v = expenseValue(e, fx);
    cur.local += v.local;
    cur.home += v.home;
    cur.count += 1;
    map.set(e.category, cur);
  }
  return CATEGORIES.filter((c) => map.has(c.id))
    .map((c) => ({ ...c, ...map.get(c.id) }))
    .sort((a, b) => b.local - a.local);
}

// Per tappa, nell'ordine del viaggio: spese del giorno più voci del viaggio già pagate con quella tappa.
// Le righe senza tappa (o con una tappa eliminata) finiscono in fondo, con l'etichetta di destinationOf:
// «Destinazione non indicata» con più tappe, la destinazione del viaggio (o «Tutto il viaggio») senza tappe.
// Con una sola tappa tutto va su quella.
export function totalsByStage(expenses, plan, fx, stages = [], tripDestination = '') {
  const ordered = sortStages(stages);
  const keys = [...ordered.map((s) => s.id), null];
  const map = new Map(keys.map((k) => [k, { count: 0, dailyLocal: 0, dailyHome: 0, planLocal: 0, planHome: 0 }]));
  const key = (id) => (stageById(stages, id) ? id : stages.length === 1 ? stages[0].id : null);
  for (const e of expenses) {
    const r = map.get(key(e.stage));
    const v = expenseValue(e, fx);
    r.dailyLocal += v.local;
    r.dailyHome += v.home;
    r.count += 1;
  }
  for (const p of plan) {
    if (!p.paid) continue;
    const r = map.get(key(p.stage));
    const v = planValue(p, fx);
    r.planLocal += v.local;
    r.planHome += v.home;
    r.count += 1;
  }
  return keys
    .map((k) => {
      const r = map.get(k);
      const d = destinationOf(stages, k, tripDestination);
      return { id: k, label: d.label || WHOLE_TRIP_LABEL, missing: d.missing, ...r, local: r.dailyLocal + r.planLocal, home: r.dailyHome + r.planHome };
    })
    .filter((r) => r.count > 0);
}

// Giorni con almeno una spesa, dal più recente.
export function dailySummary(expenses, fx) {
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
      return { day, ...totals(list, fx), categories: totalsByCategory(list, fx), expenses: list };
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

export function addDays(day, n) {
  const d = dateOf(day);
  d.setDate(d.getDate() + n);
  return dayKey(d);
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
  const v = fn(x);
  acc.local += v.local;
  acc.home += v.home;
  return acc;
}, { local: 0, home: 0 });

// Quadro del viaggio:
// - previsto   = tutte le voci (pagate e da pagare) + budget del giorno × giorni del viaggio
// - speso      = voci pagate + spese del giorno fatte nelle date del viaggio, fino a oggi
// - proiezione = speso + voci ancora da pagare + spese già segnate nei giorni che mancano
//                + media al giorno × giorni che mancano senza spese segnate
// La media al giorno è quella delle spese del giorno nelle date del viaggio fino a oggi (sui giorni con spese);
// finché non ce ne sono si usa il budget del giorno. Un giorno futuro con spese segnate (data scelta a mano,
// o un piano) vale quanto le sue spese: non si stima di nuovo con la media.
export function tripSummary({ expenses, plan, budget, trip, today, fx }) {
  const days = tripDays(trip);
  const left = daysLeft(trip, today);
  const inTrip = expenses.filter((e) => e.day >= trip.start && e.day <= trip.end);
  const done = inTrip.filter((e) => e.day <= today);
  const ahead = inTrip.filter((e) => e.day > today);
  const paid = plan.filter((p) => p.paid);
  const unpaid = plan.filter((p) => !p.paid);
  const planVal = (p) => planValue(p, fx);
  const expVal = (e) => expenseValue(e, fx);

  const items = sum(plan, planVal);
  const itemsPaid = sum(paid, planVal);
  const itemsUnpaid = sum(unpaid, planVal);
  const daily = sum(done, expVal);
  const dailyAhead = sum(ahead, expVal);
  const daysWithSpending = new Set(done.map((e) => e.day)).size;
  const daysAhead = new Set(ahead.map((e) => e.day)).size;
  const daysToEstimate = Math.max(0, left - daysAhead);

  const hasBudget = !!budget && budget.amount > 0;
  const budgetDay = hasBudget ? convert(budget.amount, budget.currency, fx.rate, fx) : { local: 0, home: 0 };

  let avg;
  let avgSource;
  if (daysWithSpending > 0) {
    avg = { local: daily.local / daysWithSpending, home: daily.home / daysWithSpending };
    avgSource = 'spese';
  } else if (hasBudget) {
    avg = budgetDay;
    avgSource = 'budget';
  } else {
    avg = { local: 0, home: 0 };
    avgSource = 'nessuna';
  }

  const both = (f) => ({ local: f('local'), home: f('home') });
  const previsto = both((c) => items[c] + budgetDay[c] * days);
  const speso = both((c) => itemsPaid[c] + daily[c]);
  const proiezione = both((c) => speso[c] + itemsUnpaid[c] + dailyAhead[c] + avg[c] * daysToEstimate);

  let level = 'none';
  if (previsto.local > 0 && Number.isFinite(proiezione.local)) {
    const ratio = proiezione.local / previsto.local;
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

const sig6 = (n) => Number(n.toPrecision(6));

// Indirizzi delle fonti del cambio per le valute del viaggio (codici controllati: solo 3 lettere maiuscole note).
export function rateUrls({ local, home }) {
  if (!isCurrency(local) || !isCurrency(home) || local === home) return [];
  return [
    `https://api.frankfurter.dev/v2/rate/${local.toLowerCase()}/${home.toLowerCase()}`,
    `https://api.frankfurter.dev/v1/latest?base=${home}&symbols=${local}`,
    `https://open.er-api.com/v6/latest/${home}`,
  ];
}

// Risposta di api.frankfurter.dev/v2/rate/{locale}/{casa}: unità di casa per 1 unità locale.
// Il formato si legge in modo tollerante: { rate } oppure { rates: { CASA } }.
// La data si convalida per intero, senza troncarla: "2026-11-17<script>" o "2026-11-17T00:00Z" si scartano.
export function parseFrankfurterV2(json, { home }) {
  const homePerLocal = json ? (json.rate ?? (json.rates && json.rates[home])) : undefined;
  const date = json ? json.date : undefined;
  if (!isPositiveNumber(homePerLocal) || !isISODate(date)) throw new Error('risposta frankfurter v2 non valida');
  return { value: sig6(1 / homePerLocal), date, source: 'frankfurter.dev (BCE)' };
}

// Risposta di api.frankfurter.dev/v1/latest?base={casa}&symbols={locale} (stesso formato di api.frankfurter.app)
export function parseFrankfurter(json, { local }) {
  const v = json && json.rates && json.rates[local];
  if (!isPositiveNumber(v) || !isISODate(json.date)) throw new Error('risposta frankfurter non valida');
  return { value: v, date: json.date, source: 'frankfurter.app (BCE)' };
}

// Risposta di open.er-api.com/v6/latest/{casa}
export function parseErApi(json, { local }) {
  const v = json && json.rates && json.rates[local];
  const t = json && json.time_last_update_unix;
  if (!json || json.result !== 'success' || !isPositiveNumber(v) || !Number.isInteger(t) || t <= 0) {
    throw new Error('risposta er-api non valida');
  }
  const date = dayKey(new Date(t * 1000));
  if (!isISODate(date)) throw new Error('risposta er-api non valida');
  return { value: v, date, source: 'open.er-api.com' };
}

// Un tasso è accettabile se è un numero positivo e finito. Un tasso scritto a mano molto lontano dall'ultimo
// noto (più di 5 volte, tipico di uno zero in più o in meno) va confermato.
export function isPlausibleRate(v) {
  return isPositiveNumber(v) && v < 1e9;
}

export function isFarFromRate(v, previous) {
  return previous > 0 && (v / previous > 5 || previous / v > 5);
}

// ---- Formattazione ----

// Un importo in valuta «piccola» (molte unità per 1 unità dell'altra valuta, come yen, rupie o fiorini)
// si mostra senza decimali nei totali: è più leggibile e i centesimi non contano.
export function wholeUnits(code, fx) {
  if (currencyDigits(code) === 0) return true;
  if (isExtraCurrency(code, fx)) return fx.rates ? fx.rates[code] >= 10 : false;
  if (fx.local === fx.home || !(fx.rate > 0)) return false;
  if (code === fx.local) return fx.rate >= 10;
  if (code === fx.home) return fx.rate <= 0.1;
  return false;
}

const nf = new Map();
function numberFormat(min, max) {
  const k = min + '/' + max;
  if (!nf.has(k)) nf.set(k, new Intl.NumberFormat('it-IT', { minimumFractionDigits: min, maximumFractionDigits: max, useGrouping: 'always' }));
  return nf.get(k);
}

const withSymbol = (sym, s) => (/\p{L}$/u.test(sym) ? `${sym} ${s}` : sym + s);

// Formattatori per le valute del viaggio: `local(n)` e `home(n)` per i totali, `money(importo, valuta)`
// per un importo inserito (decimali solo se ci sono, nelle valute «piccole»), anche nelle altre valute.
export function makeFormat(fx) {
  const all = symbolsOf([fx.local, fx.home, ...(fx.extra || [])]);
  const sym = { local: all[fx.local], home: all[fx.home] };
  const symbolFor = (code) => all[code] || code;
  const digits = (code) => currencyDigits(code);
  const total = (n, code) => {
    if (!Number.isFinite(n)) return '—';
    const d = wholeUnits(code, fx) ? 0 : digits(code);
    const v = d === 0 ? Math.round(n) : n;
    return withSymbol(symbolFor(code), numberFormat(d, d).format(Object.is(v, -0) ? 0 : v));
  };
  const money = (amount, code) => {
    if (!Number.isFinite(amount)) return '—';
    const d = digits(code);
    const whole = wholeUnits(code, fx);
    const hasCents = Math.round(amount * 100) % 100 !== 0;
    const min = whole ? (hasCents && d > 0 ? Math.min(2, d) : 0) : d;
    return withSymbol(symbolFor(code), numberFormat(min, Math.max(min, d)).format(amount));
  };
  return {
    same: fx.local === fx.home,
    symbol: symbolFor,
    local: (n) => total(n, fx.local),
    home: (n) => total(n, fx.home),
    money,
    // "1 € = 160,00 ¥"
    rate: (value) => `1 ${sym.home} = ${formatRate(value)} ${sym.local}`,
    // "1 € = 1,08 US$" (altra valuta)
    xrate: (code, value) => `1 ${sym.home} = ${formatRate(value)} ${symbolFor(code)}`,
  };
}

export function formatRate(value) {
  if (!(value > 0)) return '—';
  if (value >= 1) return numberFormat(2, 2).format(value);
  return new Intl.NumberFormat('it-IT', { maximumSignificantDigits: 4, useGrouping: 'always' }).format(value);
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

// "17/11" (giorno/mese, senza anno)
export function formatDayMonth(day) {
  return formatShortDate(day).slice(0, 5);
}

// Date di una tappa: "12/12–18/12", "dal 12/12", "fino al 18/12" o "".
export function stageDates(s) {
  if (s.start && s.end) return `${formatDayMonth(s.start)}–${formatDayMonth(s.end)}`;
  if (s.start) return `dal ${formatDayMonth(s.start)}`;
  if (s.end) return `fino al ${formatDayMonth(s.end)}`;
  return '';
}

// ---- CSV ----

function csvCell(v) {
  const s = String(v);
  return /[";\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

// Controvalore con i decimali della valuta della colonna, come nel riepilogo (yen 0, euro 2, dinaro kuwaitiano 3).
// Valori non calcolabili (riga senza tasso) restano vuoti nel CSV.
const numValue = (n, code) => (Number.isFinite(n) ? n.toFixed(currencyDigits(code)).replace('.', ',') : '');
// L'importo inserito con i decimali della sua valuta (yen 0, euro 2, dinaro kuwaitiano 3); un importo salvato con
// i centesimi in una valuta senza decimali (dati di versioni vecchie) li tiene, per non cambiare il valore.
const numAmount = (n, code) => {
  if (!Number.isFinite(n)) return '';
  const d = currencyDigits(code);
  return n.toFixed(d < 2 && Math.round(n * 10 ** d) / 10 ** d !== n ? 2 : d).replace('.', ',');
};
const numRate = (n) => (Number.isFinite(n) && n > 0 ? String(n >= 1 ? n.toFixed(2) : Number(n.toPrecision(6))).replace('.', ',') : '');

// Le colonne delle conversioni portano i codici delle valute del viaggio (es. importo_JPY, importo_EUR, JPY_per_EUR).
// Con altre valute nel viaggio c'è un'ultima colonna in più (es. valuta_per_EUR): il tasso della valuta della riga
// verso quella di riferimento. Senza altre valute le colonne restano quelle della v2.3.
const hasExtra = (fx) => !!(fx.extra && fx.extra.length);
export function csvHeader(fx) {
  const same = fx.local === fx.home;
  return [
    'data', 'ora', 'tipo', 'voce', 'tappa', 'stato', 'descrizione', 'importo', 'valuta',
    `importo_${fx.local}`, same ? `importo_${fx.home}_casa` : `importo_${fx.home}`, `${fx.local}_per_${fx.home}`, 'modalita', 'piano',
    ...(hasExtra(fx) ? [`valuta_per_${fx.home}`] : []),
  ];
}

// CSV per Excel/Numbers in italiano: separatore ";" e virgola decimale.
// Una riga per ogni spesa del giorno (tipo «spesa», voce = categoria) e per ogni voce del viaggio
// (tipo «viaggio», voce = volo, alloggio, traghetto...; stato pagato o previsto).
// Per una spesa `data` è il giorno scelto; `ora` è l'ora di registrazione, solo se registrata quel giorno.
// `modalita` è «reale» o «piano» (con il nome del piano): i piani non vanno sommati al reale.
// Le voci previste si convertono al tasso attuale.
export function toCSV(set, fx, { mode = 'reale', name = '' } = {}) {
  return csvHeader(fx).map(csvCell).join(';') + '\r\n' + csvRows(set, fx, mode, name);
}

// Tutti i dati in un solo file: prima il reale, poi ogni piano.
export function toCSVAll(real, scenarios, fx) {
  return csvHeader(fx).map(csvCell).join(';') + '\r\n'
    + csvRows(real, fx, 'reale', '')
    + scenarios.map((s) => csvRows(s, fx, 'piano', s.name)).join('');
}

// `set` = { expenses, plan, settings: { stages } }
function csvRows(set, fx, mode, name) {
  const stages = (set.settings && set.settings.stages) || [];
  const extraCell = (currency, xrate) => (!hasExtra(fx) ? [] : [isExtraCurrency(currency, fx) ? numRate(xrate) : '']);
  const stageCell = (id) => (stageById(stages, id) ? stageLabel(stages, id) : '');
  const time = (ts) => {
    const t = new Date(ts);
    return String(t.getHours()).padStart(2, '0') + ':' + String(t.getMinutes()).padStart(2, '0');
  };
  const rows = [
    ...set.expenses.map((e) => {
      const v = expenseValue(e, fx);
      return {
        day: e.day,
        ts: e.ts,
        cells: [
          e.day, dayKey(new Date(e.ts)) === e.day ? time(e.ts) : '', 'spesa', categoryById(e.category).label,
          stageCell(e.stage), 'pagato', '',
          numAmount(e.amount, e.currency), e.currency, numValue(v.local, fx.local), numValue(v.home, fx.home), numRate(fx.local === fx.home ? 1 : e.rate), mode, name,
          ...extraCell(e.currency, e.xrate),
        ],
      };
    }),
    ...set.plan.map((p) => {
      const v = planValue(p, fx);
      return {
        day: dayKey(new Date(p.ts)),
        ts: p.ts,
        cells: [
          dayKey(new Date(p.ts)), time(p.ts), 'viaggio', (planKindById(p.kind) || { label: p.kind }).label,
          stageCell(p.stage), p.paid ? 'pagato' : 'previsto', p.label || '',
          numAmount(p.amount, p.currency), p.currency, numValue(v.local, fx.local), numValue(v.home, fx.home), numRate(fx.local === fx.home ? 1 : planRate(p, fx)), mode, name,
          ...extraCell(p.currency, planXRate(p, fx)),
        ],
      };
    }),
  ].sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : a.ts - b.ts));
  return rows.map((r) => r.cells.map(csvCell).join(';') + '\r\n').join('');
}

// ---- Pianificazione (viaggi ipotetici) ----

// Un piano ha dati suoi (spese, voci del viaggio, budget, date, tappe) e non si somma mai al reale.
// Valute, tasso di cambio e valuta di inserimento restano comuni.
export const SCENARIO_NAME_MAX = 40;

export function cleanScenarioName(name) {
  return String(name ?? '').replace(/\s+/g, ' ').trim().slice(0, SCENARIO_NAME_MAX);
}

// "Piano 1", "Piano 2"... il primo nome libero.
export function nextScenarioName(list, base = 'Piano') {
  const used = new Set(list.map((s) => s.name));
  for (let i = 1; ; i++) if (!used.has(`${base} ${i}`)) return `${base} ${i}`;
}

// Piano vuoto (con le date e le tappe indicate) oppure copia completa dei dati reali (`copyFrom`): la copia è
// profonda, quindi cambiare il piano non tocca mai il reale.
export function makeScenario({ name, copyFrom = null, trip = null, stages = [], now = Date.now() }) {
  const src = JSON.parse(JSON.stringify(copyFrom || { expenses: [], plan: [], settings: { trip, stages } }));
  const settings = src.settings || {};
  const list = Array.isArray(settings.stages) ? settings.stages : [];
  return {
    id: newId(),
    name: cleanScenarioName(name) || 'Piano',
    createdAt: now,
    expenses: src.expenses || [],
    plan: src.plan || [],
    settings: {
      budget: copyFrom ? settings.budget || null : null,
      trip: isValidTrip(settings.trip) ? { ...settings.trip } : null,
      stages: copyFrom ? list : JSON.parse(JSON.stringify(stages)),
      stage: copyFrom && stageById(list, settings.stage) ? settings.stage : null,
    },
  };
}

// ---- Primo avvio ----

// Servono le valute e le date del viaggio; il resto (nome, destinazione, budget, tappe) è facoltativo.
export function needsSetup(settings) {
  return !isValidCurrencies(settings && settings.currencies) || !isValidTrip(settings && settings.trip);
}

export const TEXT_MAX = 60;
export const cleanText = (s) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, TEXT_MAX);

// ---- Migrazione dei dati salvati ----

// v1 (1.0–1.1.2): cdv.expenses = [{ id, ts, day, amount, currency, category, tasso }], cdv.settings.
// v2 (2.0.0): le spese hanno anche `stage`; nuove impostazioni (tappa attuale, date del viaggio) e nuove voci (cdv.plan).
// v3 (2.1.0): `day` di una spesa si può scegliere; i piani ipotetici stanno a parte in cdv.piani.
// v4 (2.2.0): app generica. Valute del viaggio scelte dall'utente (settings.currencies = { local, home }); ogni riga
//             ha `rate` (unità locali per 1 unità di casa) al posto del vecchio campo del tasso; tappe dell'utente in
//             settings.stages (per il reale e per ogni piano); nome e destinazione del viaggio.
// Fino alla v3 l'app aveva una sola coppia di valute (LEGACY_CURRENCIES) e tappe fisse: le tappe usate nei dati
// diventano tappe dell'utente con lo stesso id, così nessuna spesa perde la sua tappa.
// v5 (2.4.0): valute libere. Oltre alla valuta locale e a quella di riferimento (di casa) il viaggio può avere altre
//             valute (settings.extraCurrencies), ognuna con il suo tasso verso la valuta di riferimento
//             (settings.extraRates = { USD: { value, base, date, source, mode } }); una riga in un'altra valuta ha
//             anche `xrate`. I dati della v2.2/v2.3 restano identici: si aggiungono solo i due campi vuoti.
// La migrazione aggiunge e corregge: le righe illeggibili si contano (e restano nella copia di sicurezza che l'app
// salva prima di migrare). Rieseguirla non cambia niente.
export const SCHEMA_VERSION = 5;
export const LEGACY_CURRENCIES = Object.freeze({ local: 'THB', home: 'EUR' }); // unica coppia delle versioni 1.x–2.1
const LEGACY_RATE_FIELD = 'thbPerEur';

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const toNum = (v) => (typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN);

// Nome leggibile da un id di tappa delle versioni precedenti: "nome-composto" -> "Nome Composto".
export function legacyStageName(id) {
  return cleanStageName(String(id).split(/[-_]+/).filter(Boolean).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')) || 'Tappa';
}

function migrateRow(raw, now, seen, ctx, extra) {
  if (!isObj(raw)) return null;
  const amount = toNum(raw.amount);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  let ts = toNum(raw.ts);
  if (!Number.isFinite(ts) || ts <= 0) ts = isISODate(raw.day) ? dateOf(raw.day).getTime() : now;
  let id = typeof raw.id === 'string' && raw.id ? raw.id : newId();
  while (seen.has(id)) id += '-' + Math.random().toString(36).slice(2, 5);
  seen.add(id);
  const { [LEGACY_RATE_FIELD]: legacyRate, xrate: rawXRate, ...rest } = raw;
  const rate = toNum(ctx.legacy ? legacyRate ?? raw.rate : raw.rate);
  const currency = rowCurrency(raw.currency, ctx);
  const row = {
    ...rest,
    id,
    ts,
    // i decimali salvati non si perdono: almeno 2 (come fino alla v2.3), 3 per le valute che ne hanno 3
    amount: roundTo(amount, Math.max(2, currencyDigits(currency))),
    currency,
    stage: ctx.stageIds.has(raw.stage) ? raw.stage : null,
    rate: rate > 0 ? rate : null,
    ...extra(raw, ts),
  };
  // tasso della sua valuta: solo per le righe in un'altra valuta
  if (ctx.currencies && isExtraCurrency(currency, ctx.currencies)) {
    const x = toNum(rawXRate);
    row.xrate = x > 0 ? x : null;
  }
  return row;
}

const roundTo = (n, d) => Math.round(n * 10 ** d) / 10 ** d;

// Valuta di una riga: nei dati vecchi c'erano solo le due valute fisse; poi una delle valute del viaggio.
function rowCurrency(c, ctx) {
  const { local, home } = ctx.currencies || LEGACY_CURRENCIES;
  if (ctx.legacy) return c === LEGACY_CURRENCIES.home ? LEGACY_CURRENCIES.home : LEGACY_CURRENCIES.local;
  if (c === local || c === home) return c;
  return isCurrency(c) ? c : local;
}

// Altre valute del viaggio (dalla v2.4): quelle salvate più quelle usate davvero da qualche riga (una riga
// in una valuta che non è del viaggio non deve restare senza tasso modificabile).
function migrateExtraCurrencies(s, currencies, sets) {
  if (!currencies) return [];
  const out = [];
  const note = (c) => {
    if (isCurrency(c) && isExtraCurrency(c, currencies) && !out.includes(c)) out.push(c);
  };
  for (const c of Array.isArray(s.extraCurrencies) ? s.extraCurrencies : []) note(c);
  for (const [expenses, plan] of sets) {
    for (const list of [expenses, plan]) for (const r of Array.isArray(list) ? list : []) if (isObj(r)) note(r.currency);
  }
  return out;
}

// Tassi delle altre valute: si tengono quelli validi, riferiti alla valuta di riferimento attuale.
function migrateExtraRates(raw, currencies, extra) {
  const out = {};
  if (!isObj(raw) || !currencies) return out;
  for (const c of extra) {
    const r = raw[c];
    const value = isObj(r) ? toNum(r.value) : NaN;
    if (value > 0 && r.base === currencies.home) out[c] = { ...r, value };
  }
  return out;
}

// Spese e voci di un insieme di dati (il reale o un piano). Gli id sono unici dentro l'insieme.
function migrateLists(expenses, plan, now, report, ctx) {
  const seen = new Set();
  const outExpenses = [];
  for (const raw of Array.isArray(expenses) ? expenses : []) {
    const e = migrateRow(raw, now, seen, ctx, (r, ts) => ({
      day: isISODate(r.day) ? r.day : dayKey(new Date(ts)),
      category: categoryById(r.category).id,
    }));
    if (e) outExpenses.push(e);
    else report.dropped += 1;
  }

  const outPlan = [];
  for (const raw of Array.isArray(plan) ? plan : []) {
    const p = isObj(raw) && planKindById(raw.kind)
      ? migrateRow(raw, now, seen, ctx, (r) => ({ label: typeof r.label === 'string' ? r.label.slice(0, 80) : '', paid: r.paid === true }))
      : null;
    if (p) {
      if (!p.paid) p.rate = null;
      outPlan.push(p);
    } else report.dropped += 1;
  }
  return { expenses: outExpenses, plan: outPlan };
}

function migrateBudget(b, ctx) {
  const amount = isObj(b) ? toNum(b.amount) : NaN;
  if (!(amount > 0)) return null;
  const c = ctx.currencies;
  let currency;
  if (ctx.legacy) currency = b.currency === LEGACY_CURRENCIES.home ? LEGACY_CURRENCIES.home : LEGACY_CURRENCIES.local;
  else if (c && (b.currency === c.local || b.currency === c.home)) currency = b.currency;
  else if (c) currency = c.local;
  else return null;
  return { amount: roundTo(amount, Math.max(2, currencyDigits(currency))), currency };
}

// Tappe dell'utente (v4) già salvate: si tengono quelle leggibili, con id unici.
function migrateStageList(list) {
  const out = [];
  const ids = new Set();
  for (const raw of Array.isArray(list) ? list : []) {
    if (!isObj(raw) || typeof raw.id !== 'string' || !raw.id || ids.has(raw.id)) continue;
    const name = cleanStageName(raw.name) || legacyStageName(raw.id);
    let start = isISODate(raw.start) ? raw.start : null;
    let end = isISODate(raw.end) ? raw.end : null;
    if (start && end && end < start) [start, end] = [end, start];
    ids.add(raw.id);
    out.push({ ...raw, name, start, end });
  }
  return out;
}

// Tappe delle versioni fino alla v3: quelle davvero usate nei dati (spese, voci, tappa attuale), in ordine di uso.
function legacyStages(expenses, plan, current) {
  const firstUse = new Map();
  const note = (id, key) => {
    if (typeof id !== 'string' || !/^[a-z0-9][a-z0-9_-]{0,39}$/i.test(id)) return;
    if (!firstUse.has(id) || key < firstUse.get(id)) firstUse.set(id, key);
  };
  for (const e of Array.isArray(expenses) ? expenses : []) if (isObj(e)) note(e.stage, isISODate(e.day) ? e.day : '9999');
  for (const p of Array.isArray(plan) ? plan : []) if (isObj(p)) note(p.stage, '9999');
  note(current, '9999');
  return [...firstUse.entries()]
    .map(([id, key], i) => ({ id, key, i }))
    .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : a.i - b.i))
    .map(({ id }) => ({ id, name: legacyStageName(id), start: null, end: null }));
}

// Un insieme di dati (il reale o un piano): spese, voci e impostazioni proprie (budget, date, tappe, tappa attuale).
function migrateSet(expenses, plan, s, now, report, ctx, fallbackTrip) {
  const stages = ctx.legacy ? legacyStages(expenses, plan, s.stage) : migrateStageList(s.stages);
  const local = { ...ctx, stageIds: new Set(stages.map((x) => x.id)) };
  const lists = migrateLists(expenses, plan, now, report, local);
  const trip = isValidTrip(s.trip) ? { start: s.trip.start, end: s.trip.end } : fallbackTrip ? { ...fallbackTrip } : null;
  return {
    ...lists,
    settings: {
      ...s,
      budget: migrateBudget(s.budget, local),
      trip,
      stages,
      stage: local.stageIds.has(s.stage) ? s.stage : null,
    },
  };
}

export function migrateData({ schema, expenses, settings, plan, scenarios } = {}, now = Date.now()) {
  const fromSchema = Number(schema) >= 1 ? Number(schema) : expenses || settings ? 1 : 0;
  const report = { from: fromSchema, to: SCHEMA_VERSION, expenses: 0, plan: 0, scenarios: 0, dropped: 0 };
  const legacy = fromSchema >= 1 && fromSchema < 4;

  const s = isObj(settings) ? settings : {};
  const currencies = legacy
    ? { ...LEGACY_CURRENCIES }
    : isValidCurrencies(s.currencies) ? { local: s.currencies.local, home: s.currencies.home } : null;
  const extraCurrencies = legacy ? [] : migrateExtraCurrencies(s, currencies, [
    [expenses, plan],
    ...(Array.isArray(scenarios) ? scenarios : []).filter(isObj).map((x) => [x.expenses, x.plan]),
  ]);
  const ctx = { legacy, currencies: currencies && { ...currencies, extra: extraCurrencies } };

  // Tasso: nei dati vecchi era il tasso della coppia fissa; le prime versioni di prova salvavano un tasso
  // indicativo, che non è un tasso vero.
  let rate = { ...NO_RATE, mode: 'auto', fetchedAt: 0 };
  if (isObj(s.rate) && s.rate.source !== 'default') {
    const { [LEGACY_RATE_FIELD]: legacyValue, ...r } = s.rate;
    const value = toNum(legacy ? legacyValue ?? r.value : r.value);
    const pair = legacy ? pairOf(LEGACY_CURRENCIES) : r.pair;
    if (value > 0 && currencies && pair === pairOf(currencies)) rate = { ...r, value, pair };
  }

  const real = migrateSet(expenses, plan, s, now, report, ctx, null);
  const inputs = currencies ? [currencies.local, currencies.home, ...extraCurrencies] : [];
  const outSettings = {
    ...real.settings,
    currencies,
    rate,
    extraCurrencies,
    extraRates: migrateExtraRates(s.extraRates, currencies, extraCurrencies),
    inputCurrency: legacy
      ? (s.inputCurrency === LEGACY_CURRENCIES.home ? LEGACY_CURRENCIES.home : LEGACY_CURRENCIES.local)
      : inputs.includes(s.inputCurrency) ? s.inputCurrency : currencies ? currencies.local : null,
    tripName: cleanText(s.tripName),
    destination: cleanText(s.destination),
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
    const set = migrateSet(raw.expenses, raw.plan, isObj(raw.settings) ? raw.settings : {}, now, report, ctx, outSettings.trip);
    const created = toNum(raw.createdAt);
    outScenarios.push({
      ...raw,
      id,
      name: cleanScenarioName(raw.name) || nextScenarioName(outScenarios),
      createdAt: created > 0 ? created : now,
      ...set,
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

// Importo in forma modificabile per i campi di testo: 120 -> "120", 3.5 -> "3,50", 1.235 KWD -> "1,235".
// I decimali sono quelli con cui l'importo è salvato: almeno 2, 3 per le valute che ne hanno 3.
export function amountToInput(n, code) {
  return Number.isInteger(n) ? String(n) : n.toFixed(Math.max(2, code ? currencyDigits(code) : 2)).replace('.', ',');
}
