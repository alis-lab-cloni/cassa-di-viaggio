import {
  CATEGORIES, PLAN_KINDS, SCHEMA_VERSION, LEVEL_TEXT, NO_RATE, NO_STAGE_LABEL, fillMissingRate, categoryById,
  stageById, stageLabel, sortStages, stageOfDay, stageDates, makeStage, cleanStageName, planKindById, convert,
  expenseValue, planValue, currentRate, pairOf, isValidCurrencies, currencyOptions, currencyName, dayKey, addDays,
  makeExpense, makePlanItem, setPlanPaid, keypadInput, parseAmount, parseDecimal, quickAmounts, dayBudget, spentIn,
  budgetStatus, expensesOfDay, totals, totalsByCategory, totalsByStage, dailySummary, tripSummary, daysBetween,
  isValidTrip, migrateData, rateUrls, parseFrankfurterV2, parseFrankfurter, parseErApi, isPlausibleRate,
  isFarFromRate, makeFormat, formatRate, formatDay, formatDayShort, formatShortDate, formatDayMonth, toCSVAll,
  formatKeypad, amountToInput, isISODate, makeScenario, nextScenarioName, cleanScenarioName, needsSetup, cleanText,
} from './core.js';

const APP_VERSION = '2.2.0';
const KEY = {
  schema: 'cdv.schema',
  expenses: 'cdv.expenses',
  settings: 'cdv.settings',
  plan: 'cdv.plan',
  scenarios: 'cdv.piani', // piani ipotetici: dati separati dal reale
  backup: 'cdv.backup-v1', // copia dei dati com'erano prima della migrazione alla v2
  backup2: 'cdv.backup-v2', // copia dei dati della v2.0.0 prima della migrazione alla v2.1
  backup3: 'cdv.backup-v3', // copia dei dati della v2.1.0 prima della migrazione alla v2.2
  unreadable: 'cdv.illeggibili', // dati salvati che non si riescono a leggere: non si sovrascrivono senza copia
};
const RATE_MAX_AGE_MS = 6 * 60 * 60 * 1000;
// Fonte principale Frankfurter v2 (BCE); le altre servono solo se la prima non risponde o non ha la valuta.
// A ogni fonte va solo una GET della coppia di valute del viaggio: nessuna spesa né budget.
const RATE_PARSERS = [parseFrankfurterV2, parseFrankfurter, parseErApi];

const $ = (id) => document.getElementById(id);

// ---------- Archivio locale (solo su questo telefono) e migrazione ----------

function readRaw(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function parseRaw(raw) {
  if (raw === null) return { ok: true, value: undefined };
  try {
    return { ok: true, value: JSON.parse(raw) };
  } catch {
    return { ok: false, value: undefined };
  }
}

function writeOnce(key, value) {
  try {
    if (localStorage.getItem(key) === null) localStorage.setItem(key, value);
  } catch {
    /* memoria piena: la migrazione è comunque solo additiva */
  }
}

const BACKUPS = {
  2: { key: KEY.backup2, version: '2.0.0' },
  3: { key: KEY.backup3, version: '2.1.0' },
};

// Legge i dati salvati (v1, v2.0, v2.1 o v2.2) e li porta all'ultimo schema. Prima di cambiare qualcosa salva una
// copia dei dati originali (una per versione di partenza), così niente si perde nemmeno in caso di problemi.
function loadData() {
  const raw = {
    schema: readRaw(KEY.schema), expenses: readRaw(KEY.expenses), settings: readRaw(KEY.settings), plan: readRaw(KEY.plan),
    scenarios: readRaw(KEY.scenarios),
  };
  const parsed = {
    expenses: parseRaw(raw.expenses), settings: parseRaw(raw.settings), plan: parseRaw(raw.plan), scenarios: parseRaw(raw.scenarios),
  };
  const fromOld = Number(raw.schema) !== SCHEMA_VERSION && (raw.expenses !== null || raw.settings !== null);
  if (fromOld) {
    const b = BACKUPS[Number(raw.schema)] || { key: KEY.backup, version: 'prima della 2.0.0' };
    writeOnce(b.key, JSON.stringify({ savedAt: new Date().toISOString(), version: b.version, ...raw }));
  }
  if (Object.values(parsed).some((p) => !p.ok)) writeOnce(KEY.unreadable, JSON.stringify({ savedAt: new Date().toISOString(), ...raw }));
  const m = migrateData({
    schema: raw.schema,
    expenses: parsed.expenses.value,
    settings: parsed.settings.value,
    plan: parsed.plan.value,
    scenarios: parsed.scenarios.value,
  });
  return { ...m, migrated: fromOld };
}

function save() {
  try {
    localStorage.setItem(KEY.expenses, JSON.stringify(state.real.expenses));
    localStorage.setItem(KEY.plan, JSON.stringify(state.real.plan));
    localStorage.setItem(KEY.settings, JSON.stringify(state.settings));
    localStorage.setItem(KEY.scenarios, JSON.stringify(state.scenarios));
    localStorage.setItem(KEY.schema, String(SCHEMA_VERSION));
    return true;
  } catch {
    showToast('Memoria piena: esporta il CSV da Impostazioni', null);
    return false;
  }
}

const data = loadData();

// Dati reali e piani ipotetici. `settings` del reale contiene anche ciò che è comune a tutti (valute, cambio,
// valuta di inserimento, nome e destinazione); budget, date e tappe sono propri di ogni insieme di dati (vedi cfg()).
const state = {
  real: { expenses: data.expenses, plan: data.plan, settings: data.settings },
  settings: data.settings,
  scenarios: data.scenarios,
  scenarioId: null, // piano aperto; l'app si apre sempre sul reale
  entryDay: null, // giorno scelto per le spese nuove; null = quello proposto (oggi)
  amount: '',
  category: null,
  fresh: false, // importo appena messo (rapido o da correggere): la prima cifra ricomincia da capo
  quick: null, // importo rapido scelto, evidenziato finché non si tocca il tastierino
  fix: null, // correzione dell'importo di una spesa sul tastierino: { id, currency }
  undo: null,
  editing: null,
  planEditing: null,
  stageEditing: null,
  rateConfirm: null, // tasso a mano molto diverso dal precedente: si conferma toccando di nuovo «Correggi»
  today: dayKey(),
  view: 'home',
};

// Insieme di dati attivo: il piano aperto oppure il reale. Tutte le schermate leggono e scrivono solo questo.
const scenario = () => (state.scenarioId && state.scenarios.find((x) => x.id === state.scenarioId)) || null;
const active = () => scenario() || state.real;
const cfg = () => active().settings;
const stages = () => cfg().stages;
Object.defineProperties(state, {
  expenses: { get: () => active().expenses, set: (v) => { active().expenses = v; } },
  plan: { get: () => active().plan, set: (v) => { active().plan = v; } },
});

if (data.migrated || data.report.dropped) save();

// Configurazione completa (valute e date): finché manca si mostra la configurazione guidata.
const ready = () => !needsSetup(state.settings);
const cur = () => state.settings.currencies;
const rate = () => currentRate(cur(), state.settings.rate);
const hasRate = () => rate() !== null;
const fx = () => ({ local: cur().local, home: cur().home, rate: rate() });
const same = () => cur().local === cur().home;

// Formattatori per le valute del viaggio, ricreati solo quando cambiano valute o tasso.
let fmtCache = { key: '', f: null };
function F() {
  const x = fx();
  const key = `${x.local}/${x.home}/${x.rate}`;
  if (fmtCache.key !== key) fmtCache = { key, f: makeFormat(x) };
  return fmtCache.f;
}

const val = (e) => expenseValue(e, fx());
const pval = (p) => planValue(p, fx());
// Valore di un importo nell'altra valuta (quella che non è la sua), già formattato.
function otherText(amount, currency, r) {
  if (same()) return '';
  const v = convert(amount, currency, r, fx());
  return currency === cur().home ? F().local(v.local) : F().home(v.home);
}

// Imposta un tasso vero (scaricato o manuale) e completa le spese registrate senza tasso (reali e dei piani).
function setRate(r) {
  state.settings.rate = { ...r, pair: pairOf(cur()) };
  for (const set of [state.real, ...state.scenarios]) {
    fillMissingRate(set.expenses, r.value);
    fillMissingRate(set.plan, r.value);
  }
  save();
  refreshAll();
}

// Giorno delle spese nuove: oggi; in un piano, se oggi è fuori dalle sue date, il primo giorno del piano.
function defaultEntryDay() {
  const sc = scenario();
  if (!sc || !isValidTrip(sc.settings.trip)) return state.today;
  const { start, end } = sc.settings.trip;
  return state.today >= start && state.today <= end ? state.today : start;
}

const entryDay = () => state.entryDay || defaultEntryDay();

// Con le date delle tappe la tappa attuale si sceglie da sola quando cambia il giorno delle spese nuove
// (a mezzanotte o scegliendo un altro giorno). Un tocco su un'altra tappa vale per quel giorno.
function autoStage() {
  const day = entryDay();
  const c = cfg();
  if (c.stageDay === day) return;
  const s = stageOfDay(c.stages, day);
  if (s) c.stage = s.id;
  c.stageDay = day;
  save();
}

// ---------- Elementi comuni ----------

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const icon = (id) => `<svg class="ic" aria-hidden="true"><use href="#i-${id}"></use></svg>`;

function renderCats(container, selected, onPick) {
  container.innerHTML = '';
  for (const c of CATEGORIES) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'cat' + (c.id === selected ? ' on' : '');
    b.dataset.cat = c.id;
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-checked', String(c.id === selected));
    b.innerHTML = `${icon(c.id)}<span class="t">${c.label}</span>`;
    b.addEventListener('click', () => onPick(c.id, b));
    container.appendChild(b);
  }
}

// Tappe dell'utente, nell'ordine del viaggio. Senza tappe la riga non c'è.
function renderStages(container, selected, onPick) {
  const list = sortStages(stages());
  container.hidden = !list.length;
  container.innerHTML = '';
  for (const s of list) {
    const b = document.createElement('button');
    b.type = 'button';
    b.dataset.stage = s.id;
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-label', s.name);
    b.textContent = s.name;
    b.addEventListener('click', () => onPick(s.id));
    container.appendChild(b);
  }
  markRadio(container, 'stage', selected);
}

function markRadio(container, attr, id) {
  for (const b of container.querySelectorAll(`[data-${attr}]`)) {
    const on = b.dataset[attr] === id;
    b.classList.toggle('on', on);
    b.setAttribute('aria-checked', String(on));
  }
}

const markCat = (container, id) => markRadio(container, 'cat', id);

// Pulsanti per scegliere tra valuta locale e di casa (con la stessa valuta non servono).
function renderCurSeg(container, selected) {
  const c = cur();
  const codes = same() ? [c.local] : [c.local, c.home];
  container.hidden = codes.length < 2;
  container.innerHTML = codes.map((code) => `<button type="button" data-cur="${code}" role="radio" aria-label="${esc(currencyName(code))}">${esc(F().symbol(code))}</button>`).join('');
  markRadio(container, 'cur', selected);
}

function fillCurrencySelect(select, selected, placeholder) {
  if (!select.options.length) {
    select.innerHTML = (placeholder ? `<option value="">${esc(placeholder)}</option>` : '')
      + currencyOptions().map((o) => `<option value="${o.code}">${esc(o.name)} (${o.code})</option>`).join('');
  }
  select.value = selected || '';
}

function vibrate(ms) {
  try {
    if (navigator.vibrate) navigator.vibrate(ms);
  } catch {
    /* non supportata: niente */
  }
}

// Evidenzia per un attimo un elemento (senza movimento).
function attention(el) {
  el.classList.remove('attention');
  void el.offsetWidth;
  el.classList.add('attention');
  setTimeout(() => el.classList.remove('attention'), 1600);
}

// Ci sono spese o voci (reali o nei piani)? Allora le valute non si cambiano più.
const hasAnyData = () => [state.real, ...state.scenarios].some((s) => s.expenses.length || s.plan.length);

// ---------- Configurazione guidata (primo avvio) ----------

let setupBudgetCur = null;
let setupBudgetPicked = false; // la valuta del budget l'ha scelta l'utente (o viene dai dati salvati)

function renderSetup() {
  const s = state.settings;
  const locked = hasAnyData() && isValidCurrencies(s.currencies);
  $('setup-intro').textContent = hasAnyData()
    ? 'Le tue spese sono al sicuro su questo telefono. Completa i dati del viaggio per continuare.'
    : 'Bastano pochi dati. Puoi cambiarli quando vuoi in Impostazioni.';
  if (document.activeElement !== $('setup-name')) $('setup-name').value = s.tripName || '';
  if (document.activeElement !== $('setup-dest')) $('setup-dest').value = s.destination || '';
  fillCurrencySelect($('setup-local'), $('setup-local').value || (s.currencies && s.currencies.local), 'Scegli…');
  fillCurrencySelect($('setup-home'), $('setup-home').value || (s.currencies ? s.currencies.home : 'EUR'), 'Scegli…');
  $('setup-local').disabled = locked;
  $('setup-home').disabled = locked;
  $('setup-cur-note').hidden = !locked;
  if (isValidTrip(s.trip)) {
    if (!$('setup-start').value) $('setup-start').value = s.trip.start;
    if (!$('setup-end').value) $('setup-end').value = s.trip.end;
  }
  if (s.budget && !$('setup-budget').value) {
    $('setup-budget').value = amountToInput(s.budget.amount);
    setupBudgetCur = s.budget.currency;
    setupBudgetPicked = true;
  }
  renderSetupBudgetSeg();
}

// Valuta del budget nella configurazione: si aggiorna appena si scelgono le valute.
function renderSetupBudgetSeg() {
  const local = $('setup-local').value;
  const home = $('setup-home').value;
  const seg = $('setup-budget-cur');
  const codes = [local, home].filter(Boolean).filter((c, i, a) => a.indexOf(c) === i);
  // Finché l'utente non la sceglie, il budget è nella valuta locale (quella delle spese di ogni giorno).
  if (!setupBudgetPicked || !codes.includes(setupBudgetCur)) setupBudgetCur = local || codes[0] || null;
  seg.hidden = codes.length < 2;
  const sym = local && home ? makeFormat({ local, home, rate: null }).symbol : (c) => c;
  seg.innerHTML = codes.map((c) => `<button type="button" data-cur="${c}" role="radio" aria-label="${esc(currencyName(c))}">${esc(sym(c))}</button>`).join('');
  markRadio(seg, 'cur', setupBudgetCur);
  $('setup-budget-label').textContent = codes.length === 1 ? `Budget al giorno, facoltativo (${codes[0]})` : 'Budget al giorno, facoltativo';
}

function submitSetup(ev) {
  ev.preventDefault();
  const msg = $('setup-msg');
  const fail = (text, el) => {
    msg.textContent = text;
    msg.className = 'hint err';
    if (el) el.focus();
  };
  const local = $('setup-local').value;
  const home = $('setup-home').value;
  const trip = { start: $('setup-start').value, end: $('setup-end').value };
  if (!local) return fail('Scegli la valuta locale (quella che usi nel posto dove vai).', $('setup-local'));
  if (!home) return fail('Scegli la valuta di casa.', $('setup-home'));
  if (!isISODate(trip.start) || !isISODate(trip.end)) return fail('Scegli le date di partenza e di ritorno.', $('setup-start'));
  if (!isValidTrip(trip)) return fail('Il ritorno deve essere uguale o dopo la partenza.', $('setup-end'));
  const rawBudget = $('setup-budget').value.trim();
  const amount = parseAmount(rawBudget);
  if (rawBudget && !(amount > 0)) return fail('Scrivi il budget come numero, per esempio 80 o 2000. Puoi anche lasciarlo vuoto.', $('setup-budget'));

  const s = state.settings;
  s.tripName = cleanText($('setup-name').value);
  s.destination = cleanText($('setup-dest').value);
  setCurrencies({ local, home });
  s.trip = trip;
  if (amount > 0) s.budget = { amount, currency: setupBudgetCur || local };
  save();
  for (const el of document.querySelectorAll('#setup input')) el.blur();
  $('setup').hidden = true;
  document.body.classList.remove('setup');
  refreshAll();
  updateRate();
}

// Valute del viaggio (solo finché non ci sono spese): tasso, valuta di inserimento e budget seguono la scelta.
function setCurrencies(next) {
  const s = state.settings;
  const prev = isValidCurrencies(s.currencies) ? s.currencies : null;
  if (prev && prev.local === next.local && prev.home === next.home) return false;
  s.currencies = { local: next.local, home: next.home };
  if (!prev || pairOf(prev) !== pairOf(next)) s.rate = { ...NO_RATE, mode: 'auto', fetchedAt: 0 };
  s.inputCurrency = next.local;
  const side = (c) => (prev && c === prev.home ? next.home : next.local);
  for (const set of [state.real, ...state.scenarios]) {
    if (set.settings.budget) set.settings.budget = { ...set.settings.budget, currency: side(set.settings.budget.currency) };
  }
  return true;
}

// ---------- Schermata Oggi ----------

const entryCurrency = () => (state.fix ? state.fix.currency : state.settings.inputCurrency);

function renderQuick() {
  const c = entryCurrency();
  const box = $('quick');
  const list = quickAmounts(c, fx(), cfg().budget);
  const key = c + ':' + list.join(',');
  if (box.dataset.key !== key) {
    box.dataset.key = key;
    box.innerHTML = list.map((v) => `<button type="button" data-q="${v}">${esc(F().money(v, c).replace(/,0+$/, ''))}</button>`).join('');
  }
  for (const b of box.querySelectorAll('button')) b.classList.toggle('on', b.dataset.q === state.quick);
}

function renderEntry() {
  const c = entryCurrency();
  const toggle = $('cur-toggle');
  toggle.hidden = same() && !state.fix;
  toggle.textContent = F().symbol(c);
  toggle.classList.toggle('home', c === cur().home && !same());
  toggle.classList.toggle('long', F().symbol(c).length > 2);
  toggle.setAttribute('aria-label', `Valuta: ${currencyName(c)}. Tocca per cambiare`);

  const amountEl = $('amount');
  amountEl.textContent = formatKeypad(state.amount);
  amountEl.classList.toggle('placeholder', !state.amount);

  const n = parseAmount(state.amount);
  $('amount-conv').textContent = state.fix
    ? 'Correzione'
    : !(n > 0) || same()
      ? ''
      : hasRate() ? '≈ ' + otherText(n, c, rate()) : 'manca il cambio';
  const day = entryDay();
  const other = day !== state.today;
  const done = $('done');
  done.textContent = state.fix ? 'Salva correzione' : other ? `Aggiungi spesa · ${formatDayShort(day, state.today).toLowerCase()}` : 'Aggiungi spesa';
  done.classList.toggle('ready', n > 0 && !!state.category);
  $('fix-cancel').hidden = !state.fix;
  $('amount-clear').hidden = !!state.fix || !state.amount;
  document.querySelector('.entry').classList.toggle('fixing', !!state.fix);
  renderDayChip();
  renderQuick();
}

// Giorno della spesa: proposto oggi, si cambia con un tocco (calendario del telefono) senza passi in più.
function renderDayChip() {
  const day = entryDay();
  const chip = $('day-chip');
  chip.hidden = !!state.fix;
  chip.classList.toggle('other', day !== state.today);
  $('day-chip-text').textContent = formatDayShort(day, state.today);
  const input = $('entry-day');
  if (input.value !== day) input.value = day;
  input.setAttribute('aria-label', `Giorno della spesa: ${formatDay(day, state.today)}. Tocca per cambiarlo`);
}

// "a ieri", "a domani", "al 17/11"
function toDayText(day) {
  const t = formatDayShort(day, state.today);
  return t.includes('/') ? `al ${t}` : `a ${t.toLowerCase()}`;
}

function pickEntryDay(value) {
  state.entryDay = isISODate(value) && value !== defaultEntryDay() ? value : null;
  if ($('toast').classList.contains('docked')) dismissToast();
  autoStage();
  markRadio($('stages'), 'stage', cfg().stage);
  renderEntry();
  renderBudget();
}

// Il riquadro in alto mostra il giorno scelto per le spese nuove (di solito oggi).
function renderBudget() {
  const day = entryDay();
  const spent = totals(expensesOfDay(state.expenses, day), fx());
  const b = cfg().budget;
  const rel = formatDayShort(day, state.today);
  $('spent-label').textContent = /\//.test(rel) ? `Speso il ${rel}` : `Speso ${rel.toLowerCase()}`;
  $('bar').setAttribute('aria-label', `Budget del giorno ${formatDay(day, state.today).toLowerCase()}`);
  const view = dayBudget(spent, b, fx());

  const card = $('budget-card');
  card.dataset.level = view.level;
  $('spent-local').textContent = F().local(spent.local);
  $('spent-home').textContent = same() ? '' : F().home(spent.home);

  const remBox = document.querySelector('.remaining');
  const pct = Math.min(100, Math.round(view.ratio * 100));
  $('bar-fill').style.width = (b ? Math.max(pct, spent.count ? 2 : 0) : 0) + '%';
  $('bar').setAttribute('aria-valuenow', String(pct));

  if (!b) {
    $('remaining-label').textContent = 'Budget del giorno';
    $('remaining-local').textContent = '–';
    $('remaining-home').innerHTML = '<button type="button" class="link-btn" id="set-budget">Imposta</button>';
    remBox.classList.remove('over');
    $('set-budget').addEventListener('click', () => {
      showView('settings');
      $('budget-input').focus();
    });
  } else {
    const over = view.remaining < 0;
    remBox.classList.toggle('over', over);
    $('remaining-label').textContent = over ? 'Oltre il budget di' : `Restano su ${F().money(b.amount, b.currency)}`;
    $('remaining-local').textContent = F().local(Math.abs(view.remainingLocal));
    $('remaining-home').textContent = same() ? '' : F().home(Math.abs(view.remainingHome));
  }

  const last = lastExpense();
  const lastBtn = $('last-expense');
  if (last) {
    lastBtn.hidden = false;
    lastBtn.innerHTML = `Ultima: ${esc(F().money(last.amount, last.currency))} · ${esc(categoryById(last.category).label)} <span aria-hidden="true">›</span>`;
    lastBtn.setAttribute('aria-label', 'Modifica o cancella l\'ultima spesa');
  } else {
    lastBtn.hidden = true;
  }
}

function lastExpense() {
  return [...state.expenses].sort((a, c) => c.ts - a.ts)[0];
}

// "1€ = 160,00¥", "1 CHF = 1,05 €": spazio solo accanto ai simboli fatti di lettere.
function compactRate(value) {
  const f = F();
  const h = f.symbol(cur().home);
  const l = f.symbol(cur().local);
  return `1${/\p{L}/u.test(h) ? ' ' : ''}${h} = ${formatRate(value)}${/\p{L}/u.test(l) ? ' ' : ''}${l}`;
}

function renderRateChip() {
  const r = state.settings.rate;
  const chip = $('rate-chip');
  chip.hidden = !!scenario() || same();
  if (!hasRate()) {
    chip.textContent = 'Cambio mancante · tocca qui';
    chip.classList.add('stale');
  } else {
    const d = r.date ? formatDayMonth(r.date) : '';
    chip.textContent = `${compactRate(rate())}${r.mode === 'manual' ? ' (a mano)' : d ? ' · ' + d : ''}`;
    const ageDays = r.date ? (Date.now() - new Date(r.date + 'T12:00:00').getTime()) / 86400000 : 99;
    chip.classList.toggle('stale', ageDays > 4);
  }
}

function renderHome() {
  autoStage();
  renderStages($('stages'), cfg().stage, pickStage);
  renderEntry();
  renderBudget();
  renderRateChip();
}

function onKey(k) {
  if ($('toast').classList.contains('docked')) dismissToast();
  const start = state.fresh && /^\d/.test(k) ? '' : state.amount;
  state.fresh = false;
  state.quick = null;
  state.amount = keypadInput(start, k);
  renderEntry();
}

// Importo rapido: un tocco = importo inserito (sostituisce quello scritto).
function onQuick(v) {
  if ($('toast').classList.contains('docked')) dismissToast();
  state.amount = String(v);
  state.fresh = true;
  state.quick = String(v);
  renderEntry();
}

function pickCategory(id) {
  state.category = state.category === id ? null : id;
  markCat($('cats'), state.category);
  renderEntry();
}

// La tappa attuale vale per le spese che si aggiungono da ora: un tocco, nessun passo in più.
function pickStage(id) {
  if (cfg().stage === id) return;
  cfg().stage = id;
  cfg().stageDay = entryDay();
  save();
  markRadio($('stages'), 'stage', id);
  vibrate(8);
}

function addExpense() {
  if (state.fix) return saveFix();
  const amount = parseAmount(state.amount);
  if (!(amount > 0)) {
    attention(document.querySelector('.amount-row'));
    showToast('Scrivi l\'importo o tocca un importo rapido', null, 2500);
    return;
  }
  if (!state.category) {
    attention($('cats'));
    showToast('Scegli la categoria', null, 2500);
    return;
  }
  const exp = makeExpense({
    amount,
    currency: state.settings.inputCurrency,
    category: state.category,
    stage: stageById(stages(), cfg().stage) ? cfg().stage : null,
    rate: rate(),
    day: entryDay(),
  });
  const before = snapshot();
  state.expenses.push(exp);
  save();

  state.amount = '';
  state.fresh = false;
  state.quick = null;
  state.category = null;
  markCat($('cats'), null);
  renderHome();
  if (state.view === 'summary') renderSummary();

  vibrate(10);
  state.undo = before;
  const when = exp.day === state.today ? '' : ` · ${formatDayShort(exp.day, state.today).toLowerCase()}`;
  const where = exp.stage ? ` · ${stageLabel(stages(), exp.stage)}` : '';
  showToast(`${scenario() ? 'Nel piano: a' : 'A'}ggiunta ${F().money(exp.amount, exp.currency)} · ${categoryById(exp.category).label}${where}${when}`, undo);
}

// ---------- Avviso con «Annulla» ----------

let toastTimer = null;

// Nella schermata Oggi l'avviso si appoggia sulla riga dell'importo (vuota subito dopo il salvataggio),
// così non copre mai tastierino e categorie; al primo tasto premuto sparisce.
function showToast(text, onUndo, ms = 6000) {
  const t = $('toast');
  const docked = state.view === 'home' && ready();
  t.classList.toggle('docked', docked);
  if (docked) {
    const r = document.querySelector('.amount-row').getBoundingClientRect();
    Object.assign(t.style, { top: r.top + 'px', left: r.left + 'px', width: r.width + 'px', height: r.height + 'px' });
  } else {
    Object.assign(t.style, { top: '', left: '', width: '', height: '' });
  }
  $('toast-text').textContent = text;
  const btn = $('toast-undo');
  btn.hidden = !onUndo;
  btn.onclick = onUndo ? () => { onUndo(); } : null;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(hideToast, ms);
}

function dismissToast() {
  clearTimeout(toastTimer);
  hideToast();
}

function hideToast() {
  $('toast').hidden = true;
  state.undo = null;
}

// «Annulla» rimette spese e voci com'erano prima dell'ultima modifica.
function snapshot() {
  return { expenses: state.expenses.map((e) => ({ ...e })), plan: state.plan.map((p) => ({ ...p })) };
}

function undo() {
  const u = state.undo;
  if (!u) return;
  state.expenses = u.expenses;
  state.plan = u.plan;
  save();
  dismissToast();
  refreshAll();
  showToast('Annullato', null, 1500);
  vibrate(8);
}

function changed(before, message) {
  save();
  refreshAll();
  state.undo = before;
  vibrate(8);
  showToast(message, undo);
}

// ---------- Modifica / cancella una spesa ----------

// La scheda mostra importo, categoria e tappa della spesa:
// - un tocco su un'altra categoria o tappa la cambia e salva subito (Ultima → categoria = 2 tocchi);
// - un tocco sull'importo apre il tastierino precompilato con «Salva correzione».
function openEdit(id) {
  const exp = state.expenses.find((e) => e.id === id);
  if (!exp) return;
  if (state.fix) cancelFix();
  state.editing = id;
  const when = new Date(exp.ts);
  const time = when.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
  const reg = dayKey(when) === exp.day ? `alle ${time}` : `registrata il ${formatDayMonth(dayKey(when))} alle ${time}`;
  const where = stages().length || exp.stage ? ` · ${stageLabel(stages(), exp.stage)}` : '';
  $('sheet-when').textContent = `${formatDay(exp.day, state.today)} · ${reg}${where}`;
  $('edit-amount').textContent = F().money(exp.amount, exp.currency);
  $('edit-day').value = exp.day;
  $('edit-hint').textContent = stages().length ? 'Tocca un\'altra categoria o tappa per cambiarla subito.' : 'Tocca un\'altra categoria per cambiarla subito.';
  renderCats($('edit-cats'), exp.category, changeCategory);
  renderStages($('edit-stages'), exp.stage, changeStage);
  $('sheet').hidden = false;
}

function closeEdit() {
  $('sheet').hidden = true;
  state.editing = null;
}

function updateExpense(id, changes, message) {
  const exp = state.expenses.find((e) => e.id === id);
  if (!exp) return;
  const before = snapshot();
  state.expenses = state.expenses.map((e) => (e.id === id ? { ...exp, ...changes } : e));
  changed(before, message);
}

function changeCategory(cid) {
  const id = state.editing;
  const exp = state.expenses.find((e) => e.id === id);
  closeEdit();
  if (!exp || exp.category === cid) return;
  updateExpense(id, { category: cid }, `Categoria cambiata: ${categoryById(cid).label}`);
}

function changeStage(sid) {
  const id = state.editing;
  const exp = state.expenses.find((e) => e.id === id);
  closeEdit();
  if (!exp || exp.stage === sid) return;
  updateExpense(id, { stage: sid }, `Tappa cambiata: ${stageLabel(stages(), sid)}`);
}

// Sposta la spesa in un altro giorno: salva subito, con «Annulla».
function changeDay(value) {
  const id = state.editing;
  const exp = state.expenses.find((e) => e.id === id);
  if (!isISODate(value)) {
    if (exp) $('edit-day').value = exp.day;
    return;
  }
  closeEdit();
  if (!exp || exp.day === value) return;
  updateExpense(id, { day: value }, `Spesa spostata ${toDayText(value)}`);
}

function startFix() {
  const exp = state.expenses.find((e) => e.id === state.editing);
  closeEdit();
  if (!exp) return;
  showView('home');
  dismissToast();
  state.fix = { id: exp.id, currency: exp.currency };
  state.amount = amountToInput(exp.amount);
  state.fresh = true; // la prima cifra sostituisce l'importo vecchio
  state.quick = null;
  state.category = exp.category;
  markCat($('cats'), state.category);
  renderEntry();
}

function endFix() {
  state.fix = null;
  state.amount = '';
  state.fresh = false;
  state.quick = null;
  state.category = null;
  markCat($('cats'), null);
}

function cancelFix() {
  endFix();
  renderEntry();
}

function saveFix() {
  const amount = parseAmount(state.amount);
  if (!(amount > 0)) return;
  const exp = state.expenses.find((e) => e.id === state.fix.id);
  const changes = { amount, currency: state.fix.currency, category: state.category || (exp && exp.category) };
  const id = state.fix.id;
  endFix();
  if (!exp) return renderEntry();
  updateExpense(id, changes, `Spesa corretta: ${F().money(amount, changes.currency)}`);
}

function deleteEditing() {
  const exp = state.expenses.find((e) => e.id === state.editing);
  if (!exp) return closeEdit();
  const before = snapshot();
  state.expenses = state.expenses.filter((e) => e.id !== exp.id);
  closeEdit();
  changed(before, `Spesa eliminata: ${F().money(exp.amount, exp.currency)}`);
}

// ---------- Viaggio (budget dell'intero viaggio) ----------

// Totale nella valuta locale con, sotto, la valuta di casa (se diversa).
const both = (v) => `${F().local(v.local)}${same() ? '' : `<small>${F().home(v.home)}</small>`}`;

function renderTrip() {
  const s = state.settings;
  $('trip-title').textContent = scenario() ? scenario().name : s.tripName || 'Viaggio';
  const trip = cfg().trip;
  if (!isValidTrip(trip)) {
    $('trip-dates').textContent = 'Imposta le date del viaggio in Impostazioni.';
    $('trip-summary').innerHTML = '';
    $('plan-list').innerHTML = '';
    return;
  }
  const t = tripSummary({
    expenses: state.expenses, plan: state.plan, budget: cfg().budget, trip, today: state.today, fx: fx(),
  });
  let when;
  if (t.phase === 'before') {
    const n = daysBetween(state.today, trip.start);
    when = `partenza tra ${n} ${n === 1 ? 'giorno' : 'giorni'}`;
  } else if (t.phase === 'during') {
    when = `giorno ${t.days - t.daysLeft} di ${t.days}`;
  } else {
    when = 'viaggio concluso';
  }
  const dest = s.destination ? `${s.destination} · ` : '';
  $('trip-dates').textContent = `${dest}${formatShortDate(trip.start)} – ${formatShortDate(trip.end)} · ${t.days} giorni · ${when}`;

  const f = F();
  const b = cfg().budget;
  const budgetPart = b ? ` + budget del giorno ${f.money(b.amount, b.currency)} × ${t.days} giorni` : '';
  const avgText = t.avgSource === 'spese'
    ? `media al giorno ${f.local(t.avg.local)}`
    : t.avgSource === 'budget' ? `budget del giorno ${f.local(t.avg.local)}` : `media al giorno ${f.local(0)}`;
  const delta = t.proiezione.local - t.previsto.local;
  const status = t.level === 'none'
    ? ''
    : delta <= 0
      ? `Entro il previsto (margine ${f.local(-delta)})`
      : `Oltre il previsto di ${f.local(delta)}`;
  const fill = t.previsto.local > 0 ? Math.min(100, Math.round((t.speso.local / t.previsto.local) * 100)) : 0;

  const box = $('trip-summary');
  box.dataset.level = t.level;
  box.innerHTML = `
    <div class="trip-rows">
      <div class="trip-row" id="trip-previsto"><span>Previsto</span><span class="v">${both(t.previsto)}</span></div>
      <div class="trip-row" id="trip-speso"><span>Speso</span><span class="v">${both(t.speso)}</span></div>
      <div class="trip-row strong" id="trip-proiezione"><span>Proiezione a fine viaggio</span><span class="v">${both(t.proiezione)}</span></div>
    </div>
    <div class="bar" role="progressbar" aria-label="Speso sul previsto" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${fill}"><div class="bar-fill" style="width:${fill}%"></div></div>
    ${status ? `<p class="trip-status" id="trip-status">${status}</p>` : ''}
    <p class="formula" id="trip-formula">${projectionText(t, avgText)}</p>
    <p class="formula" id="trip-formula-previsto">Previsto = voli, alloggi e spostamenti ${f.local(t.items.local)}${budgetPart}.</p>
    ${t.avgSource === 'nessuna' ? '<p class="hint">Imposta il budget del giorno in Impostazioni per stimare anche le spese di ogni giorno.</p>' : ''}
    ${t.outside ? `<p class="hint">${t.outside} ${t.outside === 1 ? 'spesa fatta fuori' : 'spese fatte fuori'} dalle date del viaggio non ${t.outside === 1 ? 'è contata' : 'sono contate'} qui (${t.outside === 1 ? 'resta' : 'restano'} nel Riepilogo).</p>` : ''}`;

  const list = $('plan-list');
  if (!state.plan.length) {
    list.innerHTML = '<p class="empty-line">Nessuna voce. Aggiungi voli, alloggi e spostamenti, anche solo previsti.</p>';
    return;
  }
  list.innerHTML = t.groups.filter((g) => g.items.length).map((g) => `
    <section class="plan-group">
      <h4><span>${esc(g.label)}</span><span>${f.local(g.total.local)}</span></h4>
      ${g.items.map((p) => {
        const k = planKindById(p.kind);
        const title = p.label ? `${k.label} · ${p.label}` : k.label;
        const other = otherText(p.amount, p.currency, p.paid && p.rate > 0 ? p.rate : rate());
        return `<div class="plan-row${p.paid ? ' paid' : ''}">
          <button type="button" class="plan-main" data-plan-edit="${esc(p.id)}">
            <span class="t">${esc(title)}<br><span class="sub">${esc(stageLabel(stages(), p.stage))}</span></span>
            <span class="v">${esc(f.money(p.amount, p.currency))}${other ? `<small>${esc(other)}</small>` : ''}</span>
          </button>
          <button type="button" class="pill" data-plan-toggle="${esc(p.id)}" aria-label="${p.paid ? 'Pagato: tocca per segnarlo da pagare' : 'Da pagare: tocca per segnarlo pagato'}">${p.paid ? 'Pagato' : 'Da pagare'}</button>
        </div>`;
      }).join('')}
    </section>`).join('');
}

// Se ci sono spese segnate nei giorni che mancano (data scelta a mano o piano), quei giorni non si stimano con la media.
function projectionText(t, avgText) {
  const f = F();
  const head = `Proiezione = speso ${f.local(t.speso.local)} + da pagare ${f.local(t.itemsUnpaid.local)}`;
  if (!t.daysAhead) return `${head} + ${avgText} × ${t.daysLeft} ${t.daysLeft === 1 ? 'giorno che manca' : 'giorni che mancano'}.`;
  const n = t.daysToEstimate;
  return `${head} + già segnate nei prossimi giorni ${f.local(t.dailyAhead.local)} + ${avgText} × ${n} ${n === 1 ? 'giorno' : 'giorni'} senza spese segnate.`;
}

function togglePaid(id) {
  const p = state.plan.find((x) => x.id === id);
  if (!p) return;
  const before = snapshot();
  const next = setPlanPaid(p, !p.paid, rate());
  state.plan = state.plan.map((x) => (x.id === id ? next : x));
  changed(before, `${planKindById(p.kind).label} ${F().money(p.amount, p.currency)}: ${next.paid ? 'pagato' : 'da pagare'}`);
}

const planForm = { kind: 'volo', cur: null, paid: false, stageTouched: false };

function openPlan(id = null) {
  const p = id ? state.plan.find((x) => x.id === id) : null;
  state.planEditing = p ? p.id : null;
  planForm.kind = p ? p.kind : 'volo';
  // un volo si paga di solito nella valuta di casa
  planForm.cur = p ? p.currency : cur().home;
  planForm.paid = p ? p.paid : false;
  planForm.stageTouched = !!p;
  $('plan-title').textContent = p ? 'Modifica voce del viaggio' : 'Nuova voce del viaggio';
  $('plan-label').value = p ? p.label : '';
  $('plan-amount').value = p ? amountToInput(p.amount) : '';
  renderPlanStageSelect();
  $('plan-stage').value = p ? (stageById(stages(), p.stage) ? p.stage : '') : defaultPlanStage(planForm.kind);
  $('plan-delete').hidden = !p;
  $('plan-msg').textContent = '';
  $('plan-msg').className = 'hint';
  renderCurSeg($('plan-cur'), planForm.cur);
  markPlanForm();
  $('plan-sheet').hidden = false;
}

function renderPlanStageSelect() {
  const list = sortStages(stages());
  $('plan-stage-field').hidden = !list.length;
  $('plan-stage').innerHTML = `<option value="">${NO_STAGE_LABEL}</option>` + list.map((s) => `<option value="${esc(s.id)}">${esc(s.name)}</option>`).join('');
}

// Volo internazionale senza tappa; alloggi e spostamenti sulla tappa attuale (si cambia con un tocco).
function defaultPlanStage(kind) {
  return kind === 'volo' || !stageById(stages(), cfg().stage) ? '' : cfg().stage;
}

function markPlanForm() {
  markRadio($('plan-kinds'), 'kind', planForm.kind);
  markRadio($('plan-cur'), 'cur', planForm.cur);
  markRadio($('plan-paid'), 'paid', planForm.paid ? '1' : '0');
}

function closePlan() {
  $('plan-sheet').hidden = true;
  state.planEditing = null;
}

function savePlan(ev) {
  ev.preventDefault();
  const amount = parseAmount($('plan-amount').value);
  if (!(amount > 0)) {
    $('plan-msg').textContent = 'Scrivi l\'importo, per esempio 650 o 1.200,50.';
    $('plan-msg').className = 'hint err';
    $('plan-amount').focus();
    return;
  }
  const fields = {
    kind: planForm.kind,
    label: $('plan-label').value.trim().slice(0, 80),
    stage: stageById(stages(), $('plan-stage').value) ? $('plan-stage').value : null,
    amount,
    currency: same() ? cur().local : planForm.cur,
  };
  const before = snapshot();
  const old = state.planEditing ? state.plan.find((x) => x.id === state.planEditing) : null;
  let item;
  if (old) {
    item = { ...old, ...fields };
    // pagata: il tasso resta quello del pagamento, a meno che cambi lo stato
    if (old.paid !== planForm.paid || !(item.rate > 0)) item = setPlanPaid(item, planForm.paid, rate());
    state.plan = state.plan.map((x) => (x.id === old.id ? item : x));
  } else {
    item = makePlanItem({ ...fields, paid: planForm.paid, rate: rate() });
    state.plan.push(item);
  }
  closePlan();
  $('plan-amount').blur();
  changed(before, `${old ? 'Voce aggiornata' : 'Voce aggiunta'}: ${planKindById(item.kind).label} ${F().money(item.amount, item.currency)}`);
}

function deletePlan() {
  const p = state.plan.find((x) => x.id === state.planEditing);
  if (!p) return closePlan();
  const before = snapshot();
  state.plan = state.plan.filter((x) => x.id !== p.id);
  closePlan();
  changed(before, `Voce eliminata: ${planKindById(p.kind).label} ${F().money(p.amount, p.currency)}`);
}

// ---------- Riepilogo ----------

const smallHome = (n) => (same() ? '' : `<small>${F().home(n)}</small>`);

function catRowsHTML(cats) {
  const max = Math.max(...cats.map((c) => c.local), 1);
  return '<div class="cat-rows">' + cats.map((c) => `
    <div class="cat-row">
      ${icon(c.id)}
      <div><div>${esc(c.label)} <span class="hint">×${c.count}</span></div><div class="meter"><i style="width:${Math.round((c.local / max) * 100)}%"></i></div></div>
      <div class="v">${F().local(c.local)}${smallHome(c.home)}</div>
    </div>`).join('') + '</div>';
}

function stageRowsHTML(rows) {
  const max = Math.max(...rows.map((r) => r.local), 1);
  return '<div class="cat-rows" id="stage-rows">' + rows.map((r) => {
    const parts = [];
    if (r.dailyLocal) parts.push(`spese ${F().local(r.dailyLocal)}`);
    if (r.planLocal) parts.push(`viaggio ${F().local(r.planLocal)}`);
    return `
    <div class="cat-row stage-row" data-stage-row="${esc(r.id || 'nessuna')}">
      <span></span>
      <div><div>${esc(r.label)} <span class="hint">${parts.join(' · ')}</span></div><div class="meter"><i style="width:${Math.round((r.local / max) * 100)}%"></i></div></div>
      <div class="v">${F().local(r.local)}${smallHome(r.home)}</div>
    </div>`;
  }).join('') + '</div>';
}

function renderSummary() {
  const box = $('summary');
  const paidPlan = state.plan.filter((p) => p.paid);
  if (!state.expenses.length && !paidPlan.length) {
    box.innerHTML = '<div class="empty">Ancora nessuna spesa.<br>Registra la prima dalla schermata Oggi.</div>';
    return;
  }
  const b = cfg().budget;
  const x = fx();
  const byStage = totalsByStage(state.expenses, state.plan, x, stages());
  let html = '';
  // con le tappe (o voci già pagate) il primo riquadro è per tappa
  if (stages().length || paidPlan.length) {
    html += `
    <div class="card">
      <h3>${stages().length ? 'Per tappa' : 'Spese e voci pagate'}</h3>
      <p class="hint">Spese del giorno più voli, alloggi e spostamenti già pagati.</p>
      ${stageRowsHTML(byStage)}
    </div>`;
  }

  if (state.expenses.length) {
    const all = totals(state.expenses, x);
    const days = dailySummary(state.expenses, x);
    html += `
    <div class="card">
      <h3>Spese del giorno, in totale</h3>
      <div class="totals-grid">
        <div><div class="label">Totale</div><div class="big">${F().local(all.local)}</div><div class="small">${same() ? '' : F().home(all.home)}</div></div>
        <div><div class="label">Media al giorno</div><div class="big">${F().local(all.local / days.length)}</div><div class="small">${same() ? '' : F().home(all.home / days.length)}</div></div>
      </div>
      <h4 class="sub-head">Per categoria</h4>
      ${catRowsHTML(totalsByCategory(state.expenses, x))}
    </div>`;

    for (const d of days) {
      const level = b ? budgetStatus(spentIn(d, b.currency, x), b.amount).level : 'none';
      html += `
      <details class="day"${d.day === state.today || d.day === entryDay() ? ' open' : ''}>
        <summary>
          <span class="dot" data-level="${level}" aria-label="${esc(LEVEL_TEXT[level] || 'Nessun budget')}"></span>
          <span><span class="d">${esc(formatDay(d.day, state.today))}</span><br><span class="n">${d.count} ${d.count === 1 ? 'spesa' : 'spese'}</span></span>
          <span class="v">${F().local(d.local)}${smallHome(d.home)}</span>
        </summary>
        <div class="day-body">
          <h4>Per categoria</h4>
          ${catRowsHTML(d.categories)}
          <h4>Spese (tocca per correggere)</h4>
          <ul class="exp-list">
            ${d.expenses.map((e) => {
              const c = categoryById(e.category);
              const t = new Date(e.ts).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
              const other = otherText(e.amount, e.currency, e.rate);
              const where = e.stage || stages().length ? ` · ${esc(stageLabel(stages(), e.stage))}` : '';
              return `<li><button type="button" data-edit="${esc(e.id)}">
                ${icon(c.id)}
                <span>${esc(c.label)}<br><span class="time">${t}${where}</span></span>
                <span class="v">${esc(F().money(e.amount, e.currency))}${other ? `<small>${esc(other)}</small>` : ''}</span>
              </button></li>`;
            }).join('')}
          </ul>
        </div>
      </details>`;
    }
  }
  box.innerHTML = html;
}

// ---------- Impostazioni ----------

let budgetCur = null;

function renderSettings() {
  const s = state.settings;
  // Il viaggio: nome, destinazione e valute (comuni al reale e ai piani)
  if (![$('info-name'), $('info-dest'), $('info-local'), $('info-home')].includes(document.activeElement)) {
    $('info-name').value = s.tripName || '';
    $('info-dest').value = s.destination || '';
    fillCurrencySelect($('info-local'), cur().local);
    fillCurrencySelect($('info-home'), cur().home);
  }
  const locked = hasAnyData();
  $('info-local').disabled = locked;
  $('info-home').disabled = locked;
  $('info-cur-note').textContent = locked
    ? 'Le valute non si cambiano dopo la prima spesa: le spese salvate restano nella loro valuta. Per un viaggio con altre valute esporta il CSV e cancella le spese.'
    : 'Valuta locale: quella che usi nel posto dove vai. Valuta di casa: quella in cui ragioni i conti.';

  const b = cfg().budget;
  budgetCur = b ? b.currency : budgetCur && [cur().local, cur().home].includes(budgetCur) ? budgetCur : cur().local;
  renderCurSeg($('budget-cur'), budgetCur);
  if (document.activeElement !== $('budget-input')) {
    $('budget-input').value = b ? amountToInput(b.amount) : '';
  }
  renderBudgetHint();
  renderRateInfo();
  if (document.activeElement !== $('trip-start') && document.activeElement !== $('trip-end')) {
    const t = cfg().trip;
    $('trip-start').value = t ? t.start : '';
    $('trip-end').value = t ? t.end : '';
  }
  renderStageList();
  const sc = scenario();
  $('settings-plan-note').hidden = !sc;
  if (sc) $('settings-plan-name').textContent = sc.name;
  $('wipe-card').hidden = !!sc;
  $('rate-card').hidden = same();
  const n = state.scenarios.length;
  $('version').textContent = `Cassa di viaggio v${APP_VERSION} · ${state.real.expenses.length} spese e ${state.real.plan.length} voci del viaggio su questo telefono${n ? ` · ${n} ${n === 1 ? 'piano' : 'piani'}` : ''}`;
}

function saveInfo(ev) {
  ev.preventDefault();
  const s = state.settings;
  s.tripName = cleanText($('info-name').value);
  s.destination = cleanText($('info-dest').value);
  let cMsg = '';
  if (!hasAnyData()) {
    const next = { local: $('info-local').value, home: $('info-home').value };
    if (isValidCurrencies(next) && setCurrencies(next)) cMsg = ' Valute cambiate: controlla il budget del giorno.';
  }
  save();
  for (const el of document.querySelectorAll('#info-form input, #info-form select')) el.blur();
  refreshAll();
  updateRate();
  const msg = $('info-msg');
  msg.textContent = 'Salvato.' + cMsg;
  msg.className = 'hint ok';
}

function renderBudgetHint() {
  const b = cfg().budget;
  const hint = $('budget-hint');
  hint.className = 'hint';
  if (!b) {
    hint.textContent = same()
      ? 'Quanto vuoi spendere al giorno? Serve anche a proporre gli importi rapidi.'
      : `Quanto vuoi spendere al giorno? Puoi scriverlo in ${currencyName(cur().local)} o in ${currencyName(cur().home)}. Serve anche a proporre gli importi rapidi.`;
    return;
  }
  const other = otherText(b.amount, b.currency, rate());
  hint.textContent = `Adesso: ${F().money(b.amount, b.currency)} al giorno${other ? ` (≈ ${other})` : ''}.`;
}

function renderRateInfo() {
  const r = state.settings.rate;
  const info = $('rate-info');
  $('rate-home-label').textContent = `1 ${F().symbol(cur().home)} =`;
  $('rate-local-label').textContent = F().symbol(cur().local);
  $('rate-input').setAttribute('aria-label', `${currencyName(cur().local)} per 1 ${currencyName(cur().home)}`);
  $('rate-input').placeholder = hasRate() ? formatRate(rate()) : '';
  if (!hasRate()) {
    info.innerHTML = `<b>Nessun cambio ancora</b><br><span class="hint">Senza rete non l'ho potuto scaricare. Scrivi qui sotto quanti ${esc(currencyName(cur().local))} vale 1 ${esc(currencyName(cur().home))} (lo trovi in banca o al cambiavalute), oppure tocca «Aggiorna ora» quando c'è rete. Le spese restano salvate e verranno convertite.</span>`;
    $('rate-refresh').textContent = 'Aggiorna ora';
    return;
  }
  const where = r.mode === 'manual'
    ? `corretto a mano il ${esc(formatShortDate(r.date))}`
    : `del ${esc(formatShortDate(r.date))}, fonte ${esc(r.source)}`;
  const ref = 10 ** Math.max(0, Math.round(Math.log10(rate())) + 1);
  info.innerHTML = `<b>${esc(F().rate(rate()))}</b><br>${esc(F().local(ref))} = ${esc(F().home(ref / rate()))}<br><span class="hint">${where}</span>`;
  $('rate-refresh').textContent = r.mode === 'manual' ? 'Torna al cambio automatico' : 'Aggiorna ora';
}

function saveBudget(ev) {
  ev.preventDefault();
  const raw = $('budget-input').value.trim();
  const amount = parseAmount(raw);
  if (!raw) {
    cfg().budget = null;
  } else if (!(amount > 0)) {
    const hint = $('budget-hint');
    hint.textContent = 'Scrivi un numero, per esempio 80 o 2000.';
    hint.className = 'hint err';
    return;
  } else {
    cfg().budget = { amount, currency: budgetCur };
  }
  save();
  $('budget-input').blur();
  refreshAll();
  const hint = $('budget-hint');
  hint.textContent = cfg().budget ? 'Salvato. ' + hint.textContent : 'Budget tolto.';
  hint.className = 'hint ok';
  vibrate(8);
}

function saveTrip(ev) {
  ev.preventDefault();
  const trip = { start: $('trip-start').value, end: $('trip-end').value };
  const msg = $('trip-msg');
  if (!isValidTrip(trip)) {
    msg.textContent = 'Scegli le due date: il ritorno deve essere uguale o dopo la partenza.';
    msg.className = 'hint err';
    return;
  }
  cfg().trip = trip;
  save();
  refreshAll();
  msg.textContent = `Salvato: ${formatShortDate(trip.start)} – ${formatShortDate(trip.end)}.`;
  msg.className = 'hint ok';
}

// ---- Tappe ----

function renderStageList() {
  const list = sortStages(stages());
  const usage = (id) => state.expenses.filter((e) => e.stage === id).length + state.plan.filter((p) => p.stage === id).length;
  $('stage-list').innerHTML = list.length
    ? list.map((s) => {
      const n = usage(s.id);
      const sub = [stageDates(s), n ? `${n} ${n === 1 ? 'riga' : 'righe'}` : ''].filter(Boolean).join(' · ');
      return `<div class="stage-item${s.id === state.stageEditing ? ' on' : ''}">
        <span class="t">${esc(s.name)}${sub ? `<br><span class="sub">${esc(sub)}</span>` : ''}</span>
        <button type="button" class="btn small-btn" data-stage-edit="${esc(s.id)}">Modifica</button>
        <button type="button" class="btn small-btn danger" data-stage-del="${esc(s.id)}" aria-label="Elimina ${esc(s.name)}">Elimina</button>
      </div>`;
    }).join('')
    : '<p class="empty-line">Nessuna tappa. Puoi aggiungerne quante vuoi, o nessuna.</p>';
  const editing = stageById(stages(), state.stageEditing);
  $('stage-save').textContent = editing ? 'Salva tappa' : 'Aggiungi tappa';
  $('stage-cancel').hidden = !editing;
}

function resetStageForm() {
  state.stageEditing = null;
  $('stage-name').value = '';
  $('stage-start').value = '';
  $('stage-end').value = '';
}

function editStage(id) {
  const s = stageById(stages(), id);
  if (!s) return;
  state.stageEditing = id;
  $('stage-name').value = s.name;
  $('stage-start').value = s.start || '';
  $('stage-end').value = s.end || '';
  $('stage-msg').textContent = '';
  renderStageList();
  $('stage-name').focus();
}

function saveStage(ev) {
  ev.preventDefault();
  const msg = $('stage-msg');
  const name = cleanStageName($('stage-name').value);
  const start = $('stage-start').value || null;
  const end = $('stage-end').value || null;
  if (!name) {
    msg.textContent = 'Scrivi il nome della tappa (una città, un luogo).';
    msg.className = 'hint err';
    $('stage-name').focus();
    return;
  }
  if (start && end && end < start) {
    msg.textContent = 'La fine della tappa deve essere uguale o dopo l\'inizio.';
    msg.className = 'hint err';
    return;
  }
  const c = cfg();
  const old = stageById(c.stages, state.stageEditing);
  if (old) {
    c.stages = c.stages.map((s) => (s.id === old.id ? { ...s, name, start, end } : s));
    msg.textContent = `Tappa «${name}» aggiornata.`;
  } else {
    const s = makeStage({ name, start, end });
    c.stages = [...c.stages, s];
    // la prima tappa diventa quella attuale
    if (!stageById(c.stages, c.stage)) c.stage = s.id;
    msg.textContent = `Tappa «${name}» aggiunta.`;
  }
  c.stageDay = null; // con date nuove la tappa del giorno si ricalcola
  msg.className = 'hint ok';
  resetStageForm();
  save();
  $('stage-name').blur();
  refreshAll();
}

// Eliminare una tappa: le sue spese e voci restano, «Senza tappa».
function deleteStage(id) {
  const c = cfg();
  const s = stageById(c.stages, id);
  if (!s) return;
  const n = active().expenses.filter((e) => e.stage === id).length + active().plan.filter((p) => p.stage === id).length;
  if (n && !confirm(`Eliminare la tappa «${s.name}»? ${n} ${n === 1 ? 'spesa o voce resta salvata' : 'spese e voci restano salvate'}, ${n === 1 ? 'passa' : 'passano'} a «${NO_STAGE_LABEL}».`)) return;
  c.stages = c.stages.filter((x) => x.id !== id);
  state.expenses = state.expenses.map((e) => (e.stage === id ? { ...e, stage: null } : e));
  state.plan = state.plan.map((p) => (p.stage === id ? { ...p, stage: null } : p));
  if (c.stage === id) c.stage = sortStages(c.stages)[0] ? sortStages(c.stages)[0].id : null;
  if (state.stageEditing === id) resetStageForm();
  save();
  refreshAll();
  $('stage-msg').textContent = `Tappa «${s.name}» eliminata.`;
  $('stage-msg').className = 'hint ok';
}

// ---- Cambio ----

function saveManualRate(ev) {
  ev.preventDefault();
  const v = parseDecimal($('rate-input').value);
  const msg = $('rate-msg');
  if (!isPlausibleRate(v)) {
    msg.textContent = `Scrivi quanti ${currencyName(cur().local)} vale 1 ${currencyName(cur().home)}, per esempio ${formatRate(rate() || 1.5)}.`;
    msg.className = 'hint err';
    return;
  }
  if (isFarFromRate(v, rate()) && state.rateConfirm !== v) {
    state.rateConfirm = v;
    msg.textContent = `È molto diverso dal cambio attuale (${formatRate(rate())}). Se è giusto, tocca di nuovo «Correggi».`;
    msg.className = 'hint err';
    return;
  }
  state.rateConfirm = null;
  $('rate-input').value = '';
  $('rate-input').blur();
  setRate({ value: v, date: dayKey(), source: 'manuale', mode: 'manual', fetchedAt: Date.now() });
  msg.textContent = 'Cambio corretto. Resta questo finché non tocchi «Torna al cambio automatico».';
  msg.className = 'hint ok';
}

async function fetchJSON(url, ms = 8000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, { signal: ctrl.signal, cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

let rateBusy = false;

// Aggiorna il cambio se c'è rete. Senza rete o in caso di errore resta l'ultimo tasso salvato.
async function updateRate({ force = false } = {}) {
  if (!ready() || same()) return false;
  const r = state.settings.rate;
  if (rateBusy) return false;
  if (!force && r.mode === 'manual' && hasRate()) return false;
  if (!force && hasRate() && Date.now() - (r.fetchedAt || 0) < RATE_MAX_AGE_MS) return false;
  rateBusy = true;
  const pair = { ...cur() };
  try {
    const urls = rateUrls(pair);
    for (let i = 0; i < urls.length; i++) {
      try {
        const parsed = RATE_PARSERS[i](await fetchJSON(urls[i]), pair);
        if (!isPlausibleRate(parsed.value)) continue;
        if (pairOf(cur()) !== pairOf(pair)) return false; // valute cambiate nel frattempo
        setRate({ ...parsed, mode: 'auto', fetchedAt: Date.now() });
        return true;
      } catch {
        /* provo la fonte successiva */
      }
    }
    return false;
  } finally {
    rateBusy = false;
  }
}

async function onRefreshRate() {
  const msg = $('rate-msg');
  msg.textContent = 'Aggiorno…';
  msg.className = 'hint';
  const ok = await updateRate({ force: true });
  if (ok) {
    msg.textContent = 'Cambio aggiornato.';
    msg.className = 'hint ok';
  } else {
    msg.textContent = 'Niente rete o servizio non raggiungibile: uso l\'ultimo cambio salvato.';
    msg.className = 'hint err';
  }
}

// ---------- Esporta CSV ----------

// Il CSV contiene tutto: il reale e ogni piano, riconoscibili dalle colonne «modalita» e «piano».
async function exportCSV() {
  const msg = $('export-msg');
  const real = state.real;
  const n = real.expenses.length + real.plan.length + state.scenarios.reduce((a, x) => a + x.expenses.length + x.plan.length, 0);
  if (!n) {
    msg.textContent = 'Non ci sono ancora spese da esportare.';
    msg.className = 'hint';
    return;
  }
  const name = `cassa-di-viaggio-${dayKey()}.csv`;
  const blob = new Blob(['﻿' + toCSVAll(real, state.scenarios, fx())], { type: 'text/csv;charset=utf-8' });
  const touch = matchMedia('(pointer: coarse)').matches;
  try {
    const file = new File([blob], name, { type: 'text/csv' });
    if (touch && navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: 'Cassa di viaggio' });
      msg.textContent = 'CSV pronto.';
      msg.className = 'hint ok';
      return;
    }
  } catch (e) {
    if (e && e.name === 'AbortError') return;
    /* condivisione non riuscita: scarico il file */
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  const k = state.scenarios.length;
  msg.textContent = `Scaricato ${name} (${real.expenses.length} spese, ${real.plan.length} voci del viaggio${k ? `; ${k} ${k === 1 ? 'piano' : 'piani'} a parte` : ''}).`;
  msg.className = 'hint ok';
}

// Cancella i dati reali (in un piano il pulsante non c'è: si elimina il piano dalla schermata Viaggio).
function wipe() {
  if (scenario()) return;
  const n = state.real.expenses.length + state.real.plan.length;
  if (!n) return;
  if (!confirm(`Cancellare da questo telefono tutte le ${state.real.expenses.length} spese e le ${state.real.plan.length} voci del viaggio? Non si può annullare: esporta prima il CSV.`)) return;
  state.real.expenses = [];
  state.real.plan = [];
  save();
  refreshAll();
}

// ---------- Pianificazione (piani ipotetici) ----------

// In un piano: colore diverso, fascia in alto con il nome, e ogni schermata usa solo i dati del piano.
function applyMode() {
  const sc = scenario();
  if (state.fix) endFix();
  closeEdit();
  closePlan();
  dismissToast();
  resetStageForm();
  state.entryDay = null;
  state.amount = '';
  state.fresh = false;
  state.quick = null;
  state.category = null;
  markCat($('cats'), null);
  document.body.classList.toggle('mode-plan', !!sc);
  $('mode-band').hidden = !sc;
  $('plan-tag').hidden = !sc;
  if (sc) $('mode-name').textContent = $('plan-tag-name').textContent = sc.name;
  document.querySelector('meta[name="theme-color"]').content = sc ? '#4a3f86' : '#f6f6f3';
  refreshAll();
}

function openScenario(id) {
  if (!state.scenarios.some((x) => x.id === id) || state.scenarioId === id) return;
  state.scenarioId = id;
  applyMode();
  vibrate(8);
}

function exitScenario() {
  if (!state.scenarioId) return;
  state.scenarioId = null;
  applyMode();
  vibrate(8);
}

// Nuovo piano vuoto (con le date e le tappe del viaggio reale) o copia di tutti i dati reali.
function createScenario(copy) {
  const sc = copy
    ? makeScenario({ name: nextScenarioName(state.scenarios, 'Copia del reale'), copyFrom: state.real })
    : makeScenario({ name: nextScenarioName(state.scenarios), trip: state.real.settings.trip, stages: state.real.settings.stages });
  state.scenarios.push(sc);
  if (!save()) {
    state.scenarios.pop();
    return;
  }
  state.scenarioId = sc.id;
  applyMode();
  showToast(copy ? `Piano «${sc.name}» creato con i dati reali` : `Piano «${sc.name}» creato`, null, 2500);
}

function renameScenario(ev) {
  ev.preventDefault();
  const sc = scenario();
  if (!sc) return;
  const name = cleanScenarioName($('scenario-name').value);
  const msg = $('scenario-msg');
  if (!name) {
    msg.textContent = 'Scrivi un nome per il piano.';
    msg.className = 'hint err';
    return;
  }
  sc.name = name;
  save();
  $('scenario-name').blur();
  $('mode-name').textContent = $('plan-tag-name').textContent = name;
  renderScenarios();
  $('trip-title').textContent = name;
  msg.textContent = 'Nome salvato.';
  msg.className = 'hint ok';
}

function deleteScenario() {
  const sc = scenario();
  if (!sc) return;
  if (!confirm(`Eliminare il piano «${sc.name}» (${sc.expenses.length} spese, ${sc.plan.length} voci)? I dati reali non cambiano. Non si può annullare.`)) return;
  state.scenarios = state.scenarios.filter((x) => x.id !== sc.id);
  state.scenarioId = null;
  save();
  applyMode();
  showToast(`Piano «${sc.name}» eliminato`, null, 2500);
}

function renderScenarios() {
  const sc = scenario();
  $('scenarios-card').classList.toggle('in-plan', !!sc);
  $('scenarios-hint').textContent = sc
    ? `Stai lavorando sul piano «${sc.name}»: spese, voci, budget, date e tappe sono solo del piano. I dati reali non cambiano.`
    : 'Simula un viaggio con dati a parte: date, budget, tappe, voli, alloggi, spostamenti e spese ipotizzate per giorno. Non tocca le spese vere e non entra nei totali reali.';
  $('scenario-list').innerHTML = state.scenarios.map((x) => {
    const t = x.settings.trip;
    const on = x.id === state.scenarioId;
    const dates = isValidTrip(t) ? `${formatDayMonth(t.start)}–${formatDayMonth(t.end)} · ` : '';
    return `<button type="button" class="scenario${on ? ' on' : ''}" data-scenario="${esc(x.id)}" role="radio" aria-checked="${on}">
      <span class="t">${esc(x.name)}<br><span class="sub">${dates}${x.expenses.length} spese · ${x.plan.length} voci</span></span>
      <span class="go">${on ? 'Aperto' : 'Apri'}</span>
    </button>`;
  }).join('');
  $('scenario-edit').hidden = !sc;
  $('scenario-exit').hidden = !sc;
  if (sc && document.activeElement !== $('scenario-name')) $('scenario-name').value = sc.name;
}

// ---------- Navigazione ----------

function showView(name) {
  if (name !== state.view) dismissToast();
  if (name !== 'home' && state.fix) cancelFix();
  state.view = name;
  document.body.dataset.view = name;
  for (const v of document.querySelectorAll('.view')) v.classList.toggle('active', v.id === 'view-' + name);
  for (const t of document.querySelectorAll('.tabs button')) {
    const on = t.dataset.view === name;
    t.classList.toggle('on', on);
    if (on) t.setAttribute('aria-current', 'page');
    else t.removeAttribute('aria-current');
  }
  if (!ready()) return;
  if (name === 'trip') {
    renderTrip();
    renderScenarios();
  }
  if (name === 'summary') renderSummary();
  if (name === 'settings') renderSettings();
}

function refreshAll() {
  const today = dayKey();
  if (today !== state.today) state.entryDay = null; // a mezzanotte la data proposta torna a «oggi»
  state.today = today;
  if (!ready()) {
    // primo avvio (o dati senza valute o date): la configurazione guidata copre tutto
    document.body.classList.add('setup');
    $('setup').hidden = false;
    renderSetup();
    return;
  }
  renderHome();
  if (state.view === 'trip') renderScenarios();
  if (state.view === 'trip') renderTrip();
  if (state.view === 'summary') renderSummary();
  if (state.view === 'settings') renderSettings();
}

// ---------- Aggiornamento dell'app ----------

// Quando arriva una versione nuova il service worker prende il controllo: si ricarica la pagina,
// ma solo se non si sta scrivendo niente (altrimenti alla prossima uscita dall'app).
let reloadPending = false;

function safeToReload() {
  return !state.amount && !state.fix && !state.scenarioId && $('sheet').hidden && $('plan-sheet').hidden
    && document.activeElement.tagName !== 'INPUT';
}

function reloadForUpdate() {
  if (safeToReload()) location.reload();
  else reloadPending = true;
}

// ---------- Avvio ----------

function init() {
  renderCats($('cats'), null, pickCategory);
  $('plan-kinds').innerHTML = PLAN_KINDS.map((k) => `<button type="button" data-kind="${k.id}" role="radio">${esc(k.label)}</button>`).join('');

  // Configurazione guidata
  $('setup-form').addEventListener('submit', submitSetup);
  for (const id of ['setup-local', 'setup-home']) $(id).addEventListener('change', renderSetupBudgetSeg);
  $('setup-budget-cur').addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-cur]');
    if (!b) return;
    setupBudgetCur = b.dataset.cur;
    setupBudgetPicked = true;
    markRadio($('setup-budget-cur'), 'cur', setupBudgetCur);
  });
  $('setup-start').addEventListener('change', () => {
    // il ritorno proposto non è mai prima della partenza
    const s = $('setup-start').value;
    if (isISODate(s) && (!$('setup-end').value || $('setup-end').value < s)) $('setup-end').value = addDays(s, 6);
  });

  $('keypad').addEventListener('click', (ev) => {
    const b = ev.target.closest('button[data-k]');
    if (b) onKey(b.dataset.k);
  });
  $('quick').addEventListener('click', (ev) => {
    const b = ev.target.closest('button[data-q]');
    if (b) onQuick(b.dataset.q);
  });
  $('done').addEventListener('click', addExpense);
  $('fix-cancel').addEventListener('click', cancelFix);
  $('amount-clear').addEventListener('click', () => onKey('clear'));
  $('cur-toggle').addEventListener('click', () => {
    dismissToast();
    const { local, home } = cur();
    if (state.fix) {
      state.fix.currency = state.fix.currency === local ? home : local;
    } else {
      state.settings.inputCurrency = state.settings.inputCurrency === local ? home : local;
      save();
    }
    state.fresh = false;
    state.quick = null;
    renderEntry();
  });
  $('rate-chip').addEventListener('click', () => showView('settings'));
  $('last-expense').addEventListener('click', () => {
    const last = lastExpense();
    if (last) openEdit(last.id);
  });

  document.querySelector('.tabs').addEventListener('click', (ev) => {
    const b = ev.target.closest('button[data-view]');
    if (b) showView(b.dataset.view);
  });

  $('summary').addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-edit]');
    if (b) openEdit(b.dataset.edit);
  });

  $('entry-day').addEventListener('change', (ev) => pickEntryDay(ev.target.value));
  $('edit-day').addEventListener('change', (ev) => changeDay(ev.target.value));
  // Dove si può, il calendario si apre al primo tocco anche sul computer
  for (const input of [$('entry-day'), $('edit-day')]) {
    input.addEventListener('click', () => {
      try {
        input.showPicker();
      } catch {
        /* non supportato: si apre da solo (telefono) */
      }
    });
  }
  $('edit-amount').addEventListener('click', startFix);
  $('edit-delete').addEventListener('click', deleteEditing);
  $('edit-close').addEventListener('click', closeEdit);
  $('sheet').addEventListener('click', (ev) => { if (ev.target === $('sheet')) closeEdit(); });

  // Viaggio
  $('plan-add').addEventListener('click', () => openPlan());
  $('plan-list').addEventListener('click', (ev) => {
    const t = ev.target.closest('[data-plan-toggle]');
    if (t) return togglePaid(t.dataset.planToggle);
    const e = ev.target.closest('[data-plan-edit]');
    if (e) openPlan(e.dataset.planEdit);
  });
  $('plan-kinds').addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-kind]');
    if (!b) return;
    planForm.kind = b.dataset.kind;
    if (!planForm.stageTouched) $('plan-stage').value = defaultPlanStage(planForm.kind);
    markPlanForm();
  });
  $('plan-stage').addEventListener('change', () => { planForm.stageTouched = true; });
  $('plan-cur').addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-cur]');
    if (!b) return;
    planForm.cur = b.dataset.cur;
    markPlanForm();
  });
  $('plan-paid').addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-paid]');
    if (!b) return;
    planForm.paid = b.dataset.paid === '1';
    markPlanForm();
  });
  $('plan-form').addEventListener('submit', savePlan);
  $('plan-cancel').addEventListener('click', closePlan);
  $('plan-delete').addEventListener('click', deletePlan);
  $('plan-sheet').addEventListener('click', (ev) => { if (ev.target === $('plan-sheet')) closePlan(); });

  // Pianificazione
  $('scenario-list').addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-scenario]');
    if (b) openScenario(b.dataset.scenario);
  });
  $('scenario-new').addEventListener('click', () => createScenario(false));
  $('scenario-copy').addEventListener('click', () => createScenario(true));
  $('scenario-edit').addEventListener('submit', renameScenario);
  $('scenario-delete').addEventListener('click', deleteScenario);
  $('scenario-exit').addEventListener('click', exitScenario);
  $('mode-exit').addEventListener('click', exitScenario);
  // dalla schermata Oggi l'etichetta «Piano» porta alla gestione dei piani (con «Torna al reale»)
  $('plan-tag').addEventListener('click', () => {
    showView('trip');
    $('scenarios-card').scrollIntoView({ block: 'start' });
  });

  // Impostazioni
  $('info-form').addEventListener('submit', saveInfo);
  $('budget-form').addEventListener('submit', saveBudget);
  $('budget-cur').addEventListener('click', (ev) => {
    const b = ev.target.closest('button[data-cur]');
    if (!b) return;
    budgetCur = b.dataset.cur;
    markRadio($('budget-cur'), 'cur', budgetCur);
  });
  $('trip-form').addEventListener('submit', saveTrip);
  $('stage-form').addEventListener('submit', saveStage);
  $('stage-cancel').addEventListener('click', () => {
    resetStageForm();
    $('stage-msg').textContent = '';
    renderStageList();
  });
  $('stage-list').addEventListener('click', (ev) => {
    const e = ev.target.closest('[data-stage-edit]');
    if (e) return editStage(e.dataset.stageEdit);
    const d = ev.target.closest('[data-stage-del]');
    if (d) deleteStage(d.dataset.stageDel);
  });
  $('rate-form').addEventListener('submit', saveManualRate);
  $('rate-refresh').addEventListener('click', onRefreshRate);
  $('export').addEventListener('click', exportCSV);
  $('wipe').addEventListener('click', wipe);

  // Tastiera fisica (comoda al computer)
  document.addEventListener('keydown', (ev) => {
    if (!ready()) return;
    if (!$('sheet').hidden || !$('plan-sheet').hidden) {
      if (ev.key === 'Escape') {
        closeEdit();
        closePlan();
      }
      return;
    }
    if (state.view !== 'home' || ev.target.closest('input, select')) return;
    if (ev.key === 'Escape' && state.fix) cancelFix();
    else if (/^\d$/.test(ev.key)) onKey(ev.key);
    else if (ev.key === ',' || ev.key === '.') onKey(',');
    else if (ev.key === 'Backspace') onKey('back');
    else if (ev.key === 'Enter') addExpense();
  });

  // Installazione su Android (Chrome mostra il suo prompt solo se richiesto)
  let deferredPrompt = null;
  window.addEventListener('beforeinstallprompt', (ev) => {
    ev.preventDefault();
    deferredPrompt = ev;
    $('install-btn').hidden = false;
  });
  $('install-btn').addEventListener('click', async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    await deferredPrompt.userChoice.catch(() => {});
    deferredPrompt = null;
    $('install-btn').hidden = true;
  });

  // Cambio giorno a mezzanotte e ritorno nell'app. Dopo più di 10 minuti fuori dall'app la data proposta torna a «oggi».
  setInterval(() => { if (dayKey() !== state.today) refreshAll(); }, 60 * 1000);
  let hiddenAt = 0;
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') hiddenAt = Date.now();
    if (document.visibilityState === 'hidden' && reloadPending) location.reload();
    if (document.visibilityState === 'visible') {
      if (hiddenAt && Date.now() - hiddenAt > 10 * 60 * 1000) state.entryDay = null;
      refreshAll();
      updateRate();
    }
  });
  window.addEventListener('online', () => updateRate());

  refreshAll();
  updateRate();

  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
  if ('serviceWorker' in navigator) {
    const hadController = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (hadController) reloadForUpdate();
    });
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

init();
