import {
  CATEGORIES, STAGES, PLAN_KINDS, CURRENCIES, SCHEMA_VERSION, LEVEL_TEXT, hasRate, fillMissingRate, categoryById,
  stageById, stageLabel, planKindById, toTHB, toEUR, expenseTHB, expenseEUR, planTHB, planEUR, dayKey,
  makeExpense, makePlanItem, setPlanPaid, keypadInput, parseAmount, dayBudget, budgetStatus, expensesOfDay, totals,
  totalsByCategory, totalsByStage, dailySummary, tripSummary, daysBetween, isValidTrip, migrateData, parseFrankfurterV2, parseFrankfurter,
  parseErApi, isPlausibleRate, formatTHB, formatEUR, formatMoney, formatRate, formatDay, formatDayShort, formatShortDate,
  formatDayMonth, toCSVAll, formatKeypad, amountToInput, quickAmounts, isISODate, makeScenario, nextScenarioName,
  cleanScenarioName,
} from './core.js';

const APP_VERSION = '2.1.0';
const KEY = {
  schema: 'cdv.schema',
  expenses: 'cdv.expenses',
  settings: 'cdv.settings',
  plan: 'cdv.plan',
  scenarios: 'cdv.piani', // piani ipotetici: dati separati dal reale
  backup: 'cdv.backup-v1', // copia dei dati com'erano prima della migrazione alla v2
  backup2: 'cdv.backup-v2', // copia dei dati della v2.0.0 prima della migrazione alla v2.1
  unreadable: 'cdv.illeggibili', // dati salvati che non si riescono a leggere: non si sovrascrivono senza copia
};
const RATE_MAX_AGE_MS = 6 * 60 * 60 * 1000;
// Fonte principale Frankfurter v2 (BCE); le altre servono solo se la prima non risponde.
// A ogni fonte va solo una GET della coppia THB/EUR: nessuna spesa né budget.
const RATE_SOURCES = [
  { url: 'https://api.frankfurter.dev/v2/rate/thb/eur', parse: parseFrankfurterV2 },
  { url: 'https://api.frankfurter.dev/v1/latest?base=EUR&symbols=THB', parse: parseFrankfurter },
  { url: 'https://open.er-api.com/v6/latest/EUR', parse: parseErApi },
];

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

// Legge i dati salvati (v1, v2.0 o v2.1) e li porta all'ultimo schema. Prima di cambiare qualcosa salva una copia
// dei dati originali (una per versione di partenza), così niente si perde nemmeno in caso di problemi.
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
    const v2 = Number(raw.schema) === 2;
    writeOnce(v2 ? KEY.backup2 : KEY.backup, JSON.stringify({ savedAt: new Date().toISOString(), version: v2 ? '2.0.0' : 'prima della 2.0.0', ...raw }));
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

// Dati reali e piani ipotetici. `settings` del reale contiene anche ciò che è comune a tutti (cambio, valuta di
// inserimento); budget, date e tappa sono propri di ogni insieme di dati (vedi cfg()).
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
  today: dayKey(),
  view: 'home',
};

// Insieme di dati attivo: il piano aperto oppure il reale. Tutte le schermate leggono e scrivono solo questo.
const scenario = () => (state.scenarioId && state.scenarios.find((x) => x.id === state.scenarioId)) || null;
const active = () => scenario() || state.real;
const cfg = () => active().settings;
Object.defineProperties(state, {
  expenses: { get: () => active().expenses, set: (v) => { active().expenses = v; } },
  plan: { get: () => active().plan, set: (v) => { active().plan = v; } },
});

if (data.migrated || data.report.dropped) save();

const rate = () => state.settings.rate.thbPerEur;

// Imposta un tasso vero (scaricato o manuale) e completa le spese registrate senza tasso (reali e dei piani).
function setRate(r) {
  state.settings.rate = r;
  for (const set of [state.real, ...state.scenarios]) {
    fillMissingRate(set.expenses, r.thbPerEur);
    fillMissingRate(set.plan, r.thbPerEur);
  }
  save();
  refreshAll();
}

// Giorno delle spese nuove: oggi; in un piano, se oggi è fuori dalle sue date, il primo giorno del piano.
function defaultEntryDay() {
  const sc = scenario();
  if (!sc) return state.today;
  const { start, end } = sc.settings.trip;
  return state.today >= start && state.today <= end ? state.today : start;
}

const entryDay = () => state.entryDay || defaultEntryDay();

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

function renderStages(container, selected, onPick) {
  container.innerHTML = '';
  for (const s of STAGES) {
    const b = document.createElement('button');
    b.type = 'button';
    b.dataset.stage = s.id;
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-label', s.label);
    b.textContent = s.short;
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

// ---------- Schermata Oggi ----------

const entryCurrency = () => (state.fix ? state.fix.currency : state.settings.inputCurrency);

function renderQuick() {
  const cur = entryCurrency();
  const box = $('quick');
  if (box.dataset.cur !== cur) {
    box.dataset.cur = cur;
    box.innerHTML = quickAmounts(cur)
      .map((v) => `<button type="button" data-q="${v}">${formatMoney(v, cur).replace(',00', '')}</button>`)
      .join('');
  }
  for (const b of box.querySelectorAll('button')) b.classList.toggle('on', b.dataset.q === state.quick);
}

function renderEntry() {
  const cur = entryCurrency();
  const toggle = $('cur-toggle');
  toggle.textContent = CURRENCIES[cur];
  toggle.classList.toggle('eur', cur === 'EUR');
  toggle.setAttribute('aria-label', `Valuta: ${cur === 'EUR' ? 'euro' : 'baht'}. Tocca per cambiare`);

  const amountEl = $('amount');
  amountEl.textContent = formatKeypad(state.amount);
  amountEl.classList.toggle('placeholder', !state.amount);

  const n = parseAmount(state.amount);
  const conv = cur === 'EUR' ? formatTHB(toTHB(n, 'EUR', rate())) : formatEUR(toEUR(n, 'THB', rate()));
  $('amount-conv').textContent = state.fix
    ? 'Correzione'
    : !(n > 0)
      ? ''
      : hasRate(state.settings.rate) ? '≈ ' + conv : 'manca il cambio';
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
  renderEntry();
  renderBudget();
}

// Il riquadro in alto mostra il giorno scelto per le spese nuove (di solito oggi).
function renderBudget() {
  const day = entryDay();
  const spent = totals(expensesOfDay(state.expenses, day));
  const b = cfg().budget;
  const rel = formatDayShort(day, state.today);
  $('spent-label').textContent = /\//.test(rel) ? `Speso il ${rel}` : `Speso ${rel.toLowerCase()}`;
  $('bar').setAttribute('aria-label', `Budget del giorno ${formatDay(day, state.today).toLowerCase()}`);
  const view = dayBudget(spent, b, rate());

  const card = $('budget-card');
  card.dataset.level = view.level;
  $('spent-thb').textContent = formatTHB(spent.thb);
  $('spent-eur').textContent = formatEUR(spent.eur);

  const remBox = document.querySelector('.remaining');
  const pct = Math.min(100, Math.round(view.ratio * 100));
  $('bar-fill').style.width = (b ? Math.max(pct, spent.count ? 2 : 0) : 0) + '%';
  $('bar').setAttribute('aria-valuenow', String(pct));

  if (!b) {
    $('remaining-label').textContent = 'Budget del giorno';
    $('remaining-thb').textContent = '–';
    $('remaining-eur').innerHTML = '<button type="button" class="link-btn" id="set-budget">Imposta</button>';
    remBox.classList.remove('over');
    $('set-budget').addEventListener('click', () => {
      showView('settings');
      $('budget-input').focus();
    });
  } else {
    const over = view.remaining < 0;
    remBox.classList.toggle('over', over);
    $('remaining-label').textContent = over ? 'Oltre il budget di' : `Restano su ${formatMoney(b.amount, b.currency)}`;
    $('remaining-thb').textContent = formatTHB(Math.abs(view.remainingTHB));
    $('remaining-eur').textContent = formatEUR(Math.abs(view.remainingEUR));
  }

  const last = lastExpense();
  const lastBtn = $('last-expense');
  if (last) {
    lastBtn.hidden = false;
    lastBtn.innerHTML = `Ultima: ${esc(formatMoney(last.amount, last.currency))} · ${esc(categoryById(last.category).label)} <span aria-hidden="true">›</span>`;
    lastBtn.setAttribute('aria-label', 'Modifica o cancella l\'ultima spesa');
  } else {
    lastBtn.hidden = true;
  }
}

function lastExpense() {
  return [...state.expenses].sort((a, c) => c.ts - a.ts)[0];
}

function renderRateChip() {
  const r = state.settings.rate;
  const chip = $('rate-chip');
  if (!hasRate(r)) {
    chip.textContent = 'Cambio mancante · tocca qui';
    chip.classList.add('stale');
  } else {
    const d = r.date ? formatDayMonth(r.date) : '';
    chip.textContent = `1€ = ${formatRate(r.thbPerEur)}฿${r.mode === 'manual' ? ' (a mano)' : d ? ' · ' + d : ''}`;
    const ageDays = r.date ? (Date.now() - new Date(r.date + 'T12:00:00').getTime()) / 86400000 : 99;
    chip.classList.toggle('stale', ageDays > 4);
  }
}

function renderHome() {
  markRadio($('stages'), 'stage', cfg().stage);
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
    stage: cfg().stage,
    thbPerEur: rate(),
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
  showToast(`${scenario() ? 'Nel piano: a' : 'A'}ggiunta ${formatMoney(exp.amount, exp.currency)} · ${categoryById(exp.category).label} · ${stageLabel(exp.stage)}${when}`, undo);
}

// ---------- Avviso con «Annulla» ----------

let toastTimer = null;

// Nella schermata Oggi l'avviso si appoggia sulla riga dell'importo (vuota subito dopo il salvataggio),
// così non copre mai tastierino e categorie; al primo tasto premuto sparisce.
function showToast(text, onUndo, ms = 6000) {
  const t = $('toast');
  const docked = state.view === 'home';
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
  $('sheet-when').textContent = `${formatDay(exp.day, state.today)} · ${reg} · ${stageLabel(exp.stage)}`;
  $('edit-amount').textContent = formatMoney(exp.amount, exp.currency);
  $('edit-day').value = exp.day;
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
  updateExpense(id, { stage: sid }, `Tappa cambiata: ${stageLabel(sid)}`);
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
  updateExpense(id, changes, `Spesa corretta: ${formatMoney(amount, changes.currency)}`);
}

function deleteEditing() {
  const exp = state.expenses.find((e) => e.id === state.editing);
  if (!exp) return closeEdit();
  const before = snapshot();
  state.expenses = state.expenses.filter((e) => e.id !== exp.id);
  closeEdit();
  changed(before, `Spesa eliminata: ${formatMoney(exp.amount, exp.currency)}`);
}

// ---------- Viaggio (budget dell'intero viaggio) ----------

const both = (v) => `${formatTHB(v.thb)}<small>${formatEUR(v.eur)}</small>`;

function renderTrip() {
  const trip = cfg().trip;
  const t = tripSummary({
    expenses: state.expenses, plan: state.plan, budget: cfg().budget, trip, today: state.today, thbPerEur: rate(),
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
  $('trip-dates').textContent = `${formatShortDate(trip.start)} – ${formatShortDate(trip.end)} · ${t.days} giorni · ${when}`;

  const b = cfg().budget;
  const budgetPart = b ? ` + budget del giorno ${formatMoney(b.amount, b.currency)} × ${t.days} giorni` : '';
  const avgText = t.avgSource === 'spese'
    ? `media al giorno ${formatTHB(t.avg.thb)}`
    : t.avgSource === 'budget' ? `budget del giorno ${formatTHB(t.avg.thb)}` : 'media al giorno ฿0';
  const delta = t.proiezione.thb - t.previsto.thb;
  const status = t.level === 'none'
    ? ''
    : delta <= 0
      ? `Entro il previsto (margine ${formatTHB(-delta)})`
      : `Oltre il previsto di ${formatTHB(delta)}`;
  const fill = t.previsto.thb > 0 ? Math.min(100, Math.round((t.speso.thb / t.previsto.thb) * 100)) : 0;

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
    <p class="formula" id="trip-formula-previsto">Previsto = voli, alloggi e spostamenti ${formatTHB(t.items.thb)}${budgetPart}.</p>
    ${t.avgSource === 'nessuna' ? '<p class="hint">Imposta il budget del giorno in Impostazioni per stimare anche le spese di ogni giorno.</p>' : ''}
    ${t.outside ? `<p class="hint">${t.outside} ${t.outside === 1 ? 'spesa fatta fuori' : 'spese fatte fuori'} dalle date del viaggio non ${t.outside === 1 ? 'è contata' : 'sono contate'} qui (${t.outside === 1 ? 'resta' : 'restano'} nel Riepilogo).</p>` : ''}`;

  const list = $('plan-list');
  if (!state.plan.length) {
    list.innerHTML = '<p class="empty-line">Nessuna voce. Aggiungi voli, alloggi e spostamenti, anche solo previsti.</p>';
    return;
  }
  list.innerHTML = t.groups.filter((g) => g.items.length).map((g) => `
    <section class="plan-group">
      <h4><span>${esc(g.label)}</span><span>${formatTHB(g.total.thb)}</span></h4>
      ${g.items.map((p) => {
        const k = planKindById(p.kind);
        const title = p.label ? `${k.label} · ${p.label}` : k.label;
        const other = p.currency === 'EUR' ? formatTHB(planTHB(p, rate())) : formatEUR(planEUR(p, rate()));
        return `<div class="plan-row${p.paid ? ' paid' : ''}">
          <button type="button" class="plan-main" data-plan-edit="${esc(p.id)}">
            <span class="t">${esc(title)}<br><span class="sub">${esc(stageLabel(p.stage))}</span></span>
            <span class="v">${formatMoney(p.amount, p.currency)}<small>${other}</small></span>
          </button>
          <button type="button" class="pill" data-plan-toggle="${esc(p.id)}" aria-label="${p.paid ? 'Pagato: tocca per segnarlo da pagare' : 'Da pagare: tocca per segnarlo pagato'}">${p.paid ? 'Pagato' : 'Da pagare'}</button>
        </div>`;
      }).join('')}
    </section>`).join('');
}

// Se ci sono spese segnate nei giorni che mancano (data scelta a mano o piano), quei giorni non si stimano con la media.
function projectionText(t, avgText) {
  const head = `Proiezione = speso ${formatTHB(t.speso.thb)} + da pagare ${formatTHB(t.itemsUnpaid.thb)}`;
  if (!t.daysAhead) return `${head} + ${avgText} × ${t.daysLeft} ${t.daysLeft === 1 ? 'giorno che manca' : 'giorni che mancano'}.`;
  const n = t.daysToEstimate;
  return `${head} + già segnate nei prossimi giorni ${formatTHB(t.dailyAhead.thb)} + ${avgText} × ${n} ${n === 1 ? 'giorno' : 'giorni'} senza spese segnate.`;
}

function togglePaid(id) {
  const p = state.plan.find((x) => x.id === id);
  if (!p) return;
  const before = snapshot();
  const next = setPlanPaid(p, !p.paid, rate());
  state.plan = state.plan.map((x) => (x.id === id ? next : x));
  changed(before, `${planKindById(p.kind).label} ${formatMoney(p.amount, p.currency)}: ${next.paid ? 'pagato' : 'da pagare'}`);
}

const planForm = { kind: 'volo', cur: 'EUR', paid: false, stageTouched: false };

function openPlan(id = null) {
  const p = id ? state.plan.find((x) => x.id === id) : null;
  state.planEditing = p ? p.id : null;
  planForm.kind = p ? p.kind : 'volo';
  planForm.cur = p ? p.currency : planForm.cur;
  planForm.paid = p ? p.paid : false;
  planForm.stageTouched = !!p;
  $('plan-title').textContent = p ? 'Modifica voce del viaggio' : 'Nuova voce del viaggio';
  $('plan-label').value = p ? p.label : '';
  $('plan-amount').value = p ? amountToInput(p.amount) : '';
  $('plan-stage').value = p ? p.stage || '' : defaultPlanStage(planForm.kind);
  $('plan-delete').hidden = !p;
  $('plan-msg').textContent = '';
  $('plan-msg').className = 'hint';
  markPlanForm();
  $('plan-sheet').hidden = false;
}

// Volo internazionale senza tappa; alloggi e spostamenti sulla tappa attuale (si cambia con un tocco).
function defaultPlanStage(kind) {
  return kind === 'volo' ? '' : cfg().stage;
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
    stage: stageById($('plan-stage').value) ? $('plan-stage').value : null,
    amount,
    currency: planForm.cur,
  };
  const before = snapshot();
  const old = state.planEditing ? state.plan.find((x) => x.id === state.planEditing) : null;
  let item;
  if (old) {
    item = { ...old, ...fields };
    // pagata: il tasso resta quello del pagamento, a meno che cambi lo stato
    if (old.paid !== planForm.paid || !(item.thbPerEur > 0)) item = setPlanPaid(item, planForm.paid, rate());
    state.plan = state.plan.map((x) => (x.id === old.id ? item : x));
  } else {
    item = makePlanItem({ ...fields, paid: planForm.paid, thbPerEur: rate() });
    state.plan.push(item);
  }
  closePlan();
  $('plan-amount').blur();
  changed(before, `${old ? 'Voce aggiornata' : 'Voce aggiunta'}: ${planKindById(item.kind).label} ${formatMoney(item.amount, item.currency)}`);
}

function deletePlan() {
  const p = state.plan.find((x) => x.id === state.planEditing);
  if (!p) return closePlan();
  const before = snapshot();
  state.plan = state.plan.filter((x) => x.id !== p.id);
  closePlan();
  changed(before, `Voce eliminata: ${planKindById(p.kind).label} ${formatMoney(p.amount, p.currency)}`);
}

// ---------- Riepilogo ----------

function catRowsHTML(cats) {
  const max = Math.max(...cats.map((c) => c.thb), 1);
  return '<div class="cat-rows">' + cats.map((c) => `
    <div class="cat-row">
      ${icon(c.id)}
      <div><div>${esc(c.label)} <span class="hint">×${c.count}</span></div><div class="meter"><i style="width:${Math.round((c.thb / max) * 100)}%"></i></div></div>
      <div class="v">${formatTHB(c.thb)}<small>${formatEUR(c.eur)}</small></div>
    </div>`).join('') + '</div>';
}

function stageRowsHTML(rows) {
  const max = Math.max(...rows.map((r) => r.thb), 1);
  return '<div class="cat-rows" id="stage-rows">' + rows.map((r) => {
    const parts = [];
    if (r.dailyTHB) parts.push(`spese ${formatTHB(r.dailyTHB)}`);
    if (r.planTHB) parts.push(`viaggio ${formatTHB(r.planTHB)}`);
    return `
    <div class="cat-row stage-row" data-stage-row="${esc(r.id || 'nessuna')}">
      <span></span>
      <div><div>${esc(r.label)} <span class="hint">${parts.join(' · ')}</span></div><div class="meter"><i style="width:${Math.round((r.thb / max) * 100)}%"></i></div></div>
      <div class="v">${formatTHB(r.thb)}<small>${formatEUR(r.eur)}</small></div>
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
  let html = `
    <div class="card">
      <h3>Per tappa</h3>
      <p class="hint">Spese del giorno più voli, alloggi e spostamenti già pagati.</p>
      ${stageRowsHTML(totalsByStage(state.expenses, state.plan, rate()))}
    </div>`;

  if (state.expenses.length) {
    const all = totals(state.expenses);
    const days = dailySummary(state.expenses);
    html += `
    <div class="card">
      <h3>Spese del giorno, in totale</h3>
      <div class="totals-grid">
        <div><div class="label">Totale</div><div class="big">${formatTHB(all.thb)}</div><div class="small">${formatEUR(all.eur)}</div></div>
        <div><div class="label">Media al giorno</div><div class="big">${formatTHB(all.thb / days.length)}</div><div class="small">${formatEUR(all.eur / days.length)}</div></div>
      </div>
      <h4 class="sub-head">Per categoria</h4>
      ${catRowsHTML(totalsByCategory(state.expenses))}
    </div>`;

    for (const d of days) {
      const level = b ? budgetStatus(b.currency === 'EUR' ? d.eur : d.thb, b.amount).level : 'none';
      html += `
      <details class="day"${d.day === state.today || d.day === entryDay() ? ' open' : ''}>
        <summary>
          <span class="dot" data-level="${level}" aria-label="${esc(LEVEL_TEXT[level] || 'Nessun budget')}"></span>
          <span><span class="d">${esc(formatDay(d.day, state.today))}</span><br><span class="n">${d.count} ${d.count === 1 ? 'spesa' : 'spese'}</span></span>
          <span class="v">${formatTHB(d.thb)}<small>${formatEUR(d.eur)}</small></span>
        </summary>
        <div class="day-body">
          <h4>Per categoria</h4>
          ${catRowsHTML(d.categories)}
          <h4>Spese (tocca per correggere)</h4>
          <ul class="exp-list">
            ${d.expenses.map((e) => {
              const c = categoryById(e.category);
              const t = new Date(e.ts).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
              const other = e.currency === 'EUR' ? formatTHB(expenseTHB(e)) : formatEUR(expenseEUR(e));
              return `<li><button type="button" data-edit="${esc(e.id)}">
                ${icon(c.id)}
                <span>${esc(c.label)}<br><span class="time">${t} · ${esc(stageLabel(e.stage))}</span></span>
                <span class="v">${formatMoney(e.amount, e.currency)}<small>${other}</small></span>
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

let budgetCur = 'THB';

function renderSettings() {
  const b = cfg().budget;
  budgetCur = b ? b.currency : budgetCur;
  markRadio(document.querySelector('#budget-form .seg'), 'cur', budgetCur);
  if (document.activeElement !== $('budget-input')) {
    $('budget-input').value = b ? amountToInput(b.amount) : '';
  }
  renderBudgetHint();
  renderRateInfo();
  if (document.activeElement !== $('trip-start') && document.activeElement !== $('trip-end')) {
    $('trip-start').value = cfg().trip.start;
    $('trip-end').value = cfg().trip.end;
  }
  const sc = scenario();
  $('settings-plan-note').hidden = !sc;
  if (sc) $('settings-plan-name').textContent = sc.name;
  $('wipe-card').hidden = !!sc;
  const n = state.scenarios.length;
  $('version').textContent = `Cassa di viaggio v${APP_VERSION} · ${state.real.expenses.length} spese e ${state.real.plan.length} voci del viaggio su questo telefono${n ? ` · ${n} ${n === 1 ? 'piano' : 'piani'}` : ''}`;
}

function renderBudgetHint() {
  const b = cfg().budget;
  const hint = $('budget-hint');
  hint.className = 'hint';
  if (!b) {
    hint.textContent = 'Quanto vuoi spendere al giorno? Puoi scriverlo in baht o in euro.';
    return;
  }
  const other = b.currency === 'EUR' ? formatTHB(toTHB(b.amount, 'EUR', rate())) : formatEUR(toEUR(b.amount, 'THB', rate()));
  hint.textContent = `Adesso: ${formatMoney(b.amount, b.currency)} al giorno (≈ ${other}).`;
}

function renderRateInfo() {
  const r = state.settings.rate;
  const info = $('rate-info');
  let where;
  if (!hasRate(r)) {
    info.innerHTML = '<b>Nessun cambio ancora</b><br><span class="hint">Senza rete non l\'ho potuto scaricare. Scrivilo qui sotto (lo trovi in banca o al cambiavalute), oppure tocca «Aggiorna ora» quando c\'è rete. Le spese restano salvate e verranno convertite.</span>';
    $('rate-refresh').textContent = 'Aggiorna ora';
    return;
  }
  if (r.mode === 'manual') where = `corretto a mano il ${esc(formatShortDate(r.date))}`;
  else where = `del ${esc(formatShortDate(r.date))}, fonte ${esc(r.source)}`;
  info.innerHTML = `<b>1 € = ${formatRate(r.thbPerEur)} ฿</b><br>1.000 ฿ = ${formatEUR(1000 / r.thbPerEur)}<br><span class="hint">${where}</span>`;
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
    hint.textContent = 'Scrivi un numero, per esempio 2000 o 50,00.';
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
    msg.textContent = 'Il ritorno deve essere uguale o dopo la partenza.';
    msg.className = 'hint err';
    return;
  }
  cfg().trip = trip;
  save();
  refreshAll();
  msg.textContent = `Salvato: ${formatShortDate(trip.start)} – ${formatShortDate(trip.end)}.`;
  msg.className = 'hint ok';
}

function saveManualRate(ev) {
  ev.preventDefault();
  const v = parseAmount($('rate-input').value);
  const msg = $('rate-msg');
  if (!isPlausibleRate(v)) {
    msg.textContent = 'Scrivi quanti baht vale 1 euro (di solito tra 30 e 45).';
    msg.className = 'hint err';
    return;
  }
  $('rate-input').value = '';
  $('rate-input').blur();
  setRate({ thbPerEur: v, date: dayKey(), source: 'manuale', mode: 'manual', fetchedAt: Date.now() });
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
  const r = state.settings.rate;
  if (rateBusy) return false;
  if (!force && r.mode === 'manual') return false;
  if (!force && hasRate(r) && Date.now() - (r.fetchedAt || 0) < RATE_MAX_AGE_MS) return false;
  rateBusy = true;
  try {
    for (const src of RATE_SOURCES) {
      try {
        const parsed = src.parse(await fetchJSON(src.url));
        if (!isPlausibleRate(parsed.thbPerEur)) continue;
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
  const blob = new Blob(['﻿' + toCSVAll(real, state.scenarios, rate())], { type: 'text/csv;charset=utf-8' });
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
  state.entryDay = null;
  state.amount = '';
  state.fresh = false;
  state.quick = null;
  state.category = null;
  markCat($('cats'), null);
  document.body.classList.toggle('mode-plan', !!sc);
  $('mode-band').hidden = !sc;
  $('plan-tag').hidden = !sc;
  $('rate-chip').hidden = !!sc;
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

// Nuovo piano vuoto (con le date del viaggio reale) o copia di tutti i dati reali.
function createScenario(copy) {
  const sc = copy
    ? makeScenario({ name: nextScenarioName(state.scenarios, 'Copia del reale'), copyFrom: state.real })
    : makeScenario({ name: nextScenarioName(state.scenarios), trip: state.real.settings.trip });
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
    ? `Stai lavorando sul piano «${sc.name}»: spese, voci, budget e date sono solo del piano. I dati reali non cambiano.`
    : 'Simula un viaggio con dati a parte: date, budget, voli, alloggi, spostamenti e spese ipotizzate per giorno e tappa. Non tocca le spese vere e non entra nei totali reali.';
  $('scenario-list').innerHTML = state.scenarios.map((x) => {
    const t = x.settings.trip;
    const on = x.id === state.scenarioId;
    return `<button type="button" class="scenario${on ? ' on' : ''}" data-scenario="${esc(x.id)}" role="radio" aria-checked="${on}">
      <span class="t">${esc(x.name)}<br><span class="sub">${formatDayMonth(t.start)}–${formatDayMonth(t.end)} · ${x.expenses.length} spese · ${x.plan.length} voci</span></span>
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
  renderStages($('stages'), cfg().stage, pickStage);
  renderCats($('cats'), null, pickCategory);
  $('plan-kinds').innerHTML = PLAN_KINDS.map((k) => `<button type="button" data-kind="${k.id}" role="radio">${esc(k.label)}</button>`).join('');
  $('plan-stage').innerHTML = '<option value="">Nessuna tappa</option>' + STAGES.map((s) => `<option value="${s.id}">${esc(s.label)}</option>`).join('');

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
    if (state.fix) {
      state.fix.currency = state.fix.currency === 'THB' ? 'EUR' : 'THB';
    } else {
      state.settings.inputCurrency = state.settings.inputCurrency === 'THB' ? 'EUR' : 'THB';
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
  $('budget-form').addEventListener('submit', saveBudget);
  document.querySelector('#budget-form .seg').addEventListener('click', (ev) => {
    const b = ev.target.closest('button[data-cur]');
    if (!b) return;
    budgetCur = b.dataset.cur;
    markRadio(document.querySelector('#budget-form .seg'), 'cur', budgetCur);
  });
  $('trip-form').addEventListener('submit', saveTrip);
  $('rate-form').addEventListener('submit', saveManualRate);
  $('rate-refresh').addEventListener('click', onRefreshRate);
  $('export').addEventListener('click', exportCSV);
  $('wipe').addEventListener('click', wipe);

  // Tastiera fisica (comoda al computer)
  document.addEventListener('keydown', (ev) => {
    if (!$('sheet').hidden || !$('plan-sheet').hidden) {
      if (ev.key === 'Escape') {
        closeEdit();
        closePlan();
      }
      return;
    }
    if (state.view !== 'home' || ev.target.closest('input')) return;
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
