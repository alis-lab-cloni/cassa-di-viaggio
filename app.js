import {
  CATEGORIES, CURRENCIES, NO_RATE, hasRate, fillMissingRate, categoryById, toTHB, toEUR, expenseTHB, expenseEUR, dayKey,
  makeExpense, keypadInput, parseAmount, dayBudget, budgetStatus, expensesOfDay, totals, totalsByCategory,
  dailySummary, parseFrankfurterV2, parseFrankfurter, parseErApi, isPlausibleRate, formatTHB, formatEUR, formatMoney, formatRate,
  formatDay, formatShortDate, toCSV, cheerFor, formatKeypad, amountToInput, quickAmounts,
} from './core.js';

const APP_VERSION = '1.1.2';
const KEY_EXPENSES = 'cdv.expenses';
const KEY_SETTINGS = 'cdv.settings';
const RATE_MAX_AGE_MS = 6 * 60 * 60 * 1000;
// Fonte principale Frankfurter v2 (BCE); le altre servono solo se la prima non risponde.
// A ogni fonte va solo una GET della coppia THB/EUR: nessuna spesa né budget.
const RATE_SOURCES = [
  { url: 'https://api.frankfurter.dev/v2/rate/thb/eur', parse: parseFrankfurterV2 },
  { url: 'https://api.frankfurter.dev/v1/latest?base=EUR&symbols=THB', parse: parseFrankfurter },
  { url: 'https://open.er-api.com/v6/latest/EUR', parse: parseErApi },
];

const $ = (id) => document.getElementById(id);

// ---------- Archivio locale (solo su questo telefono) ----------

function load(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function save() {
  try {
    localStorage.setItem(KEY_EXPENSES, JSON.stringify(state.expenses));
    localStorage.setItem(KEY_SETTINGS, JSON.stringify(state.settings));
  } catch {
    showToast('⚠️ Memoria piena: esporta il CSV', null);
  }
}

const state = {
  expenses: load(KEY_EXPENSES, []),
  settings: {
    budget: null,
    inputCurrency: 'THB',
    rate: { ...NO_RATE, mode: 'auto', fetchedAt: 0 },
    ...load(KEY_SETTINGS, {}),
  },
  amount: '',
  category: null,
  fresh: false, // importo appena messo (rapido o da correggere): la prima cifra ricomincia da capo
  quick: null, // importo rapido scelto, evidenziato finché non si tocca il tastierino
  fix: null, // correzione dell'importo di una spesa sul tastierino: { id, currency }
  undo: null,
  editing: null,
  today: dayKey(),
  view: 'home',
};

// Le prime versioni di prova salvavano un tasso indicativo: non è un tasso vero.
if (state.settings.rate.source === 'default') state.settings.rate = { ...NO_RATE, mode: 'auto', fetchedAt: 0 };

const rate = () => state.settings.rate.thbPerEur;

// Imposta un tasso vero (scaricato o manuale) e completa le spese registrate senza tasso.
function setRate(r) {
  state.settings.rate = r;
  fillMissingRate(state.expenses, r.thbPerEur);
  save();
  refreshAll();
}

// ---------- Schermata principale ----------

function renderCats(container, selected, onPick) {
  container.innerHTML = '';
  for (const c of CATEGORIES) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'cat' + (c.id === selected ? ' on' : '');
    b.dataset.cat = c.id;
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-checked', String(c.id === selected));
    b.innerHTML = `<span class="e" aria-hidden="true">${c.emoji}</span><span class="t">${c.label}</span>`;
    b.addEventListener('click', () => onPick(c.id, b));
    container.appendChild(b);
  }
}

function markCat(container, id) {
  for (const b of container.querySelectorAll('.cat')) {
    const on = b.dataset.cat === id;
    b.classList.toggle('on', on);
    b.setAttribute('aria-checked', String(on));
  }
}

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
    ? '✏️ Correzione'
    : !(n > 0)
      ? ' '
      : hasRate(state.settings.rate) ? '≈ ' + conv : 'manca il cambio: lo converto appena c\'è';
  $('done').disabled = !(n > 0);
  $('done').textContent = state.fix ? 'Salva' : 'Fatto';
  $('fix-cancel').hidden = !state.fix;
  document.querySelector('.entry').classList.toggle('fixing', !!state.fix);
  renderQuick();
}

function renderBudget() {
  const today = expensesOfDay(state.expenses, state.today);
  const spent = totals(today);
  const b = state.settings.budget;
  const view = dayBudget(spent, b, rate());

  const card = $('budget-card');
  card.dataset.level = view.level;
  $('face').textContent = view.face;
  $('spent-thb').textContent = formatTHB(spent.thb);
  $('spent-eur').textContent = formatEUR(spent.eur);

  const remBox = document.querySelector('.remaining');
  const pct = Math.min(100, Math.round(view.ratio * 100));
  $('bar-fill').style.width = (b ? Math.max(pct, spent.count ? 3 : 0) : 0) + '%';
  $('bar').setAttribute('aria-valuenow', String(pct));

  const budgetText = $('budget-text');
  if (!b) {
    $('remaining-label').textContent = 'Restano';
    $('remaining-thb').textContent = '–';
    $('remaining-eur').textContent = '';
    remBox.classList.remove('over');
    budgetText.innerHTML = '<button type="button" class="link-btn" id="set-budget">Imposta il budget del giorno</button>';
    $('set-budget').addEventListener('click', () => {
      showView('settings');
      $('budget-input').focus();
    });
  } else {
    const over = view.remaining < 0;
    remBox.classList.toggle('over', over);
    $('remaining-label').textContent = over ? 'Sforato di' : 'Restano';
    $('remaining-thb').textContent = formatTHB(Math.abs(view.remainingTHB));
    $('remaining-eur').textContent = formatEUR(Math.abs(view.remainingEUR));
    budgetText.textContent = 'Budget ' + formatMoney(b.amount, b.currency);
  }

  const last = [...state.expenses].sort((a, c) => c.ts - a.ts)[0];
  const lastBtn = $('last-expense');
  if (last) {
    lastBtn.hidden = false;
    lastBtn.textContent = `Ultima: ${categoryById(last.category).emoji} ${formatMoney(last.amount, last.currency)} ✏️`;
    lastBtn.setAttribute('aria-label', 'Modifica o cancella l\'ultima spesa');
  } else {
    lastBtn.hidden = true;
  }
}

function renderRateChip() {
  const r = state.settings.rate;
  const chip = $('rate-chip');
  const text = `1€ = ${formatRate(r.thbPerEur)}฿`;
  if (!hasRate(r)) {
    chip.textContent = 'Cambio mancante · tocca qui';
    chip.classList.add('stale');
  } else {
    const d = r.date ? formatShortDate(r.date).slice(0, 5) : '';
    chip.textContent = (r.mode === 'manual' ? '✏️ ' : '') + text + (d ? ' · ' + d : '');
    const ageDays = r.date ? (Date.now() - new Date(r.date + 'T12:00:00').getTime()) / 86400000 : 99;
    chip.classList.toggle('stale', ageDays > 4);
  }
}

function renderHome() {
  renderEntry();
  renderBudget();
  renderRateChip();
}

function onKey(k) {
  if ($('toast').classList.contains('docked')) dismissToast();
  const start = state.fresh && /^\d/.test(k) ? '' : state.amount;
  state.fresh = false;
  state.quick = null;
  const next = keypadInput(start, k);
  if (next === state.amount) return renderEntry();
  state.amount = next;
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
}

function addExpense() {
  if (state.fix) return saveFix();
  const amount = parseAmount(state.amount);
  if (!(amount > 0)) return;
  if (!state.category) {
    const cats = $('cats');
    cats.classList.remove('nudge');
    void cats.offsetWidth;
    cats.classList.add('nudge');
    showToast('Scegli una categoria 👆', null, 2000);
    return;
  }
  const exp = makeExpense({
    amount,
    currency: state.settings.inputCurrency,
    category: state.category,
    thbPerEur: rate(),
  });
  state.expenses.push(exp);
  save();

  const catBtn = $('cats').querySelector(`[data-cat="${exp.category}"]`);
  state.amount = '';
  state.fresh = false;
  state.quick = null;
  state.category = null;
  markCat($('cats'), null);
  renderHome();
  if (state.view === 'summary') renderSummary();

  celebrate(exp, catBtn);
  state.undo = { type: 'add', id: exp.id };
  showToast(`${cheerFor(exp.category)} ${formatMoney(exp.amount, exp.currency)}`, undo);
}

// ---------- Feedback giocoso (mai bloccante: pointer-events none, tutto si autodistrugge) ----------

function celebrate(exp, fromEl) {
  const fx = $('fx');
  const emoji = categoryById(exp.category).emoji;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const start = (fromEl || $('done')).getBoundingClientRect();
  const target = $('face').getBoundingClientRect();
  const sx = start.left + start.width / 2 - 20;
  const sy = start.top + start.height / 2 - 20;

  if (!reduce) {
    const fly = document.createElement('span');
    fly.className = 'fly';
    fly.textContent = emoji;
    fly.style.left = sx + 'px';
    fly.style.top = sy + 'px';
    fly.style.setProperty('--dx', target.left + target.width / 2 - 20 - sx + 'px');
    fly.style.setProperty('--dy', target.top + target.height / 2 - 20 - sy + 'px');
    fx.appendChild(fly);
    autoRemove(fly, 1200);

    const done = $('done').getBoundingClientRect();
    const sparks = ['✨', '🪙', '⭐', '✨', '🪙', '🎉'];
    sparks.forEach((s, i) => {
      const el = document.createElement('span');
      el.className = 'spark';
      el.textContent = s;
      const a = (Math.PI * 2 * i) / sparks.length;
      el.style.left = done.left + done.width / 2 - 9 + 'px';
      el.style.top = done.top + done.height / 2 - 9 + 'px';
      el.style.setProperty('--sx', Math.cos(a) * 60 + 'px');
      el.style.setProperty('--sy', Math.sin(a) * 60 + 'px');
      fx.appendChild(el);
      autoRemove(el, 900);
    });
  }

  const face = $('face');
  face.classList.remove('bounce');
  void face.offsetWidth;
  face.classList.add('bounce');
  const status = dayBudget(totals(expensesOfDay(state.expenses, state.today)), state.settings.budget, rate());
  vibrate(status.level === 'red' ? [30, 60, 30] : 25);
}

function autoRemove(el, ms) {
  el.addEventListener('animationend', () => el.remove(), { once: true });
  setTimeout(() => el.remove(), ms);
}

function vibrate(pattern) {
  try {
    if (navigator.vibrate) navigator.vibrate(pattern);
  } catch {
    /* non supportata: niente */
  }
}

// ---------- Avviso con «Annulla» ----------

let toastTimer = null;

// Nella Cassa l'avviso si appoggia sulla riga dell'importo (vuota subito dopo il salvataggio),
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
  t.style.animation = 'none';
  void t.offsetWidth;
  t.style.animation = '';
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

function undo() {
  const u = state.undo;
  if (!u) return;
  if (u.type === 'add') {
    state.expenses = state.expenses.filter((e) => e.id !== u.id);
  } else if (u.type === 'delete') {
    state.expenses.push(u.expense);
  } else if (u.type === 'edit') {
    state.expenses = state.expenses.map((e) => (e.id === u.before.id ? u.before : e));
  }
  save();
  dismissToast();
  refreshAll();
  showToast('Annullato ↩️', null, 1500);
  vibrate(15);
}

// ---------- Modifica / cancella ----------

// La scheda mostra importo e categoria della spesa:
// - un tocco su un'altra categoria la cambia e salva subito (Ultima → categoria = 2 tocchi);
// - un tocco sull'importo apre il tastierino precompilato con «Salva».
function openEdit(id) {
  const exp = state.expenses.find((e) => e.id === id);
  if (!exp) return;
  if (state.fix) cancelFix();
  state.editing = id;
  const when = new Date(exp.ts);
  $('sheet-when').textContent = `${formatDay(exp.day)} alle ${when.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}`;
  $('edit-amount').textContent = `${formatMoney(exp.amount, exp.currency)} ✏️`;
  renderCats($('edit-cats'), exp.category, changeCategory);
  $('sheet').hidden = false;
}

function closeEdit() {
  $('sheet').hidden = true;
  state.editing = null;
}

function updateExpense(id, changes, message) {
  const exp = state.expenses.find((e) => e.id === id);
  if (!exp) return;
  const before = { ...exp };
  state.expenses = state.expenses.map((e) => (e.id === id ? { ...exp, ...changes } : e));
  save();
  refreshAll();
  state.undo = { type: 'edit', before };
  vibrate(15);
  showToast(message, undo);
}

function changeCategory(cid) {
  const id = state.editing;
  const exp = state.expenses.find((e) => e.id === id);
  closeEdit();
  if (!exp || exp.category === cid) return;
  const c = categoryById(cid);
  updateExpense(id, { category: cid }, `Categoria cambiata: ${c.emoji} ${c.label}`);
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
  updateExpense(id, changes, `Spesa corretta ✅ ${formatMoney(amount, changes.currency)}`);
}

function deleteEditing() {
  const exp = state.expenses.find((e) => e.id === state.editing);
  if (!exp) return closeEdit();
  state.expenses = state.expenses.filter((e) => e.id !== exp.id);
  save();
  closeEdit();
  refreshAll();
  state.undo = { type: 'delete', expense: exp };
  vibrate(20);
  showToast(`Spesa eliminata 🗑️ ${formatMoney(exp.amount, exp.currency)}`, undo);
}

// ---------- Riepilogo ----------

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function catRowsHTML(cats) {
  const max = Math.max(...cats.map((c) => c.thb), 1);
  return '<div class="cat-rows">' + cats.map((c) => `
    <div class="cat-row">
      <span class="e" aria-hidden="true">${c.emoji}</span>
      <div><div>${esc(c.label)} <span class="hint">×${c.count}</span></div><div class="meter"><i style="width:${Math.round((c.thb / max) * 100)}%"></i></div></div>
      <div class="v">${formatTHB(c.thb)}<small>${formatEUR(c.eur)}</small></div>
    </div>`).join('') + '</div>';
}

function renderSummary() {
  const box = $('summary');
  if (!state.expenses.length) {
    box.innerHTML = '<div class="empty"><span class="e">🧳</span>Ancora nessuna spesa.<br>Registra la prima dalla Cassa!</div>';
    return;
  }
  const all = totals(state.expenses);
  const days = dailySummary(state.expenses);
  const b = state.settings.budget;

  let html = `
    <div class="card">
      <h3>🧳 Tutto il viaggio</h3>
      <div class="totals-grid">
        <div><div class="label">Totale</div><div class="big">${formatTHB(all.thb)}</div><div class="small">${formatEUR(all.eur)}</div></div>
        <div><div class="label">Media al giorno</div><div class="big">${formatTHB(all.thb / days.length)}</div><div class="small">${formatEUR(all.eur / days.length)}</div></div>
      </div>
      <h4 class="hint">Per categoria</h4>
      ${catRowsHTML(totalsByCategory(state.expenses))}
    </div>`;

  for (const d of days) {
    const st = b ? budgetStatus(b.currency === 'EUR' ? d.eur : d.thb, b.amount) : { face: '📅' };
    html += `
      <details class="day"${d.day === state.today ? ' open' : ''}>
        <summary>
          <span class="face-s" aria-hidden="true">${st.face}</span>
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
                <span class="e" aria-hidden="true">${c.emoji}</span>
                <span>${esc(c.label)}<br><span class="time">${t}</span></span>
                <span class="v">${formatMoney(e.amount, e.currency)}<small>${other}</small></span>
              </button></li>`;
            }).join('')}
          </ul>
        </div>
      </details>`;
  }
  box.innerHTML = html;
}

// ---------- Impostazioni ----------

function markSeg(seg, cur) {
  for (const b of seg.querySelectorAll('button')) {
    const on = b.dataset.cur === cur;
    b.classList.toggle('on', on);
    b.setAttribute('aria-checked', String(on));
    b.setAttribute('role', 'radio');
  }
}

let budgetCur = 'THB';

function renderSettings() {
  const b = state.settings.budget;
  budgetCur = b ? b.currency : budgetCur;
  markSeg(document.querySelector('#budget-form .seg'), budgetCur);
  if (document.activeElement !== $('budget-input')) {
    $('budget-input').value = b ? amountToInput(b.amount) : '';
  }
  renderBudgetHint();
  renderRateInfo();
  $('version').textContent = `Cassa di viaggio v${APP_VERSION} · ${state.expenses.length} spese salvate su questo telefono`;
}

function renderBudgetHint() {
  const b = state.settings.budget;
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
    state.settings.budget = null;
  } else if (!(amount > 0)) {
    const hint = $('budget-hint');
    hint.textContent = 'Scrivi un numero, per esempio 2000 o 50,00.';
    hint.className = 'hint err';
    return;
  } else {
    state.settings.budget = { amount, currency: budgetCur };
  }
  save();
  $('budget-input').blur();
  refreshAll();
  const hint = $('budget-hint');
  hint.textContent = state.settings.budget ? '✅ Salvato! ' + hint.textContent : 'Budget tolto.';
  hint.className = 'hint ok';
  vibrate(15);
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
  msg.textContent = '✅ Cambio corretto. Resta questo finché non tocchi «Torna al cambio automatico».';
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
    msg.textContent = '✅ Cambio aggiornato.';
    msg.className = 'hint ok';
  } else {
    msg.textContent = 'Niente rete o servizio non raggiungibile: uso l\'ultimo cambio salvato.';
    msg.className = 'hint err';
  }
}

// ---------- Esporta CSV ----------

async function exportCSV() {
  const msg = $('export-msg');
  if (!state.expenses.length) {
    msg.textContent = 'Non ci sono ancora spese da esportare.';
    msg.className = 'hint';
    return;
  }
  const name = `cassa-di-viaggio-${dayKey()}.csv`;
  const blob = new Blob(['﻿' + toCSV(state.expenses)], { type: 'text/csv;charset=utf-8' });
  const touch = matchMedia('(pointer: coarse)').matches;
  try {
    const file = new File([blob], name, { type: 'text/csv' });
    if (touch && navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: 'Cassa di viaggio' });
      msg.textContent = '✅ CSV pronto.';
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
  msg.textContent = `✅ Scaricato ${name} (${state.expenses.length} spese).`;
  msg.className = 'hint ok';
}

function wipe() {
  if (!state.expenses.length) return;
  if (!confirm(`Cancellare tutte le ${state.expenses.length} spese da questo telefono? Non si può annullare: esporta prima il CSV.`)) return;
  state.expenses = [];
  save();
  refreshAll();
}

// ---------- Navigazione ----------

function showView(name) {
  if (name !== state.view) dismissToast();
  if (name !== 'home' && state.fix) cancelFix();
  state.view = name;
  for (const v of document.querySelectorAll('.view')) v.classList.toggle('active', v.id === 'view-' + name);
  for (const t of document.querySelectorAll('.tabs button')) {
    const on = t.dataset.view === name;
    t.classList.toggle('on', on);
    if (on) t.setAttribute('aria-current', 'page');
    else t.removeAttribute('aria-current');
  }
  if (name === 'summary') renderSummary();
  if (name === 'settings') renderSettings();
}

function refreshAll() {
  state.today = dayKey();
  renderHome();
  if (state.view === 'summary') renderSummary();
  if (state.view === 'settings') renderSettings();
}

// ---------- Avvio ----------

function init() {
  renderCats($('cats'), null, pickCategory);

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
    const last = [...state.expenses].sort((a, b) => b.ts - a.ts)[0];
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

  $('edit-amount').addEventListener('click', startFix);
  $('edit-delete').addEventListener('click', deleteEditing);
  $('edit-close').addEventListener('click', closeEdit);
  $('sheet').addEventListener('click', (ev) => { if (ev.target === $('sheet')) closeEdit(); });

  $('budget-form').addEventListener('submit', saveBudget);
  document.querySelector('#budget-form .seg').addEventListener('click', (ev) => {
    const b = ev.target.closest('button[data-cur]');
    if (!b) return;
    budgetCur = b.dataset.cur;
    markSeg(document.querySelector('#budget-form .seg'), budgetCur);
  });
  $('rate-form').addEventListener('submit', saveManualRate);
  $('rate-refresh').addEventListener('click', onRefreshRate);
  $('export').addEventListener('click', exportCSV);
  $('wipe').addEventListener('click', wipe);

  // Tastiera fisica (comoda al computer)
  document.addEventListener('keydown', (ev) => {
    if (!$('sheet').hidden) {
      if (ev.key === 'Escape') closeEdit();
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

  // Cambio giorno a mezzanotte e ritorno nell'app
  setInterval(() => { if (dayKey() !== state.today) refreshAll(); }, 60 * 1000);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      refreshAll();
      updateRate();
    }
  });
  window.addEventListener('online', () => updateRate());

  refreshAll();
  updateRate();

  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

init();
