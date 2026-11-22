// Driver minimo per gli e2e: il Firefox già installato, comandato con WebDriver BiDi
// tramite il WebSocket integrato in Node (>= 22). Nessuna dipendenza da npm.
//
// Percorso del browser: variabile FIREFOX (es. FIREFOX=/usr/bin/firefox-esr),
// altrimenti `firefox` o `firefox-esr` nel PATH, o Firefox.app su macOS.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';

const TIMEOUT = 30000;
const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));

export function findFirefox() {
  if (process.env.FIREFOX) {
    if (!existsSync(process.env.FIREFOX)) throw new Error(`FIREFOX=${process.env.FIREFOX}: file inesistente`);
    return process.env.FIREFOX;
  }
  const dirs = (process.env.PATH || '').split(delimiter).filter(Boolean);
  for (const name of ['firefox', 'firefox-esr']) {
    for (const d of dirs) if (existsSync(join(d, name))) return join(d, name);
  }
  const mac = '/Applications/Firefox.app/Contents/MacOS/firefox';
  if (existsSync(mac)) return mac;
  throw new Error('Firefox non trovato: installalo o indica il percorso con FIREFOX=/percorso/firefox');
}

// Preferenze del profilo di prova: nessun traffico di fondo e nessuna uscita verso internet.
// Le richieste verso host esterni passano da un proxy inesistente (127.0.0.1:9) e quindi falliscono,
// tranne quelle che il test simula (network.provideResponse non arriva mai alla rete).
const PREFS = {
  'network.proxy.type': 1,
  'network.proxy.http': '127.0.0.1',
  'network.proxy.http_port': 9,
  'network.proxy.ssl': '127.0.0.1',
  'network.proxy.ssl_port': 9,
  'network.proxy.no_proxies_on': 'localhost, 127.0.0.1',
  'network.proxy.allow_hijacking_localhost': false,
  'network.captive-portal-service.enabled': false,
  'network.connectivity-service.enabled': false,
  'browser.safebrowsing.malware.enabled': false,
  'browser.safebrowsing.phishing.enabled': false,
  'datareporting.policy.dataSubmissionEnabled': false,
  'toolkit.telemetry.enabled': false,
  'app.update.enabled': false,
  'intl.accept_languages': 'it-IT, it',
  'dom.serviceWorkers.enabled': true,
  // barre di scorrimento sovrapposte come sul telefono: non tolgono larghezza alla pagina
  'ui.useOverlayScrollbars': 1,
  'widget.gtk.overlay-scrollbars.enabled': true,
};

class Firefox {
  constructor(proc, ws, profile) {
    this.proc = proc;
    this.ws = ws;
    this.profile = profile;
    this.id = 0;
    this.pending = new Map();
    this.listeners = new Set();
    ws.onmessage = (m) => {
      const msg = JSON.parse(m.data);
      if (msg.id !== undefined && this.pending.has(msg.id)) {
        const { ok, ko, method } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.type === 'error') ko(new Error(`${method}: ${msg.error} ${msg.message || ''}`));
        else ok(msg.result);
      } else if (msg.type === 'event') {
        for (const fn of this.listeners) fn(msg.method, msg.params);
      }
    };
  }

  send(method, params = {}, timeout = TIMEOUT) {
    const id = ++this.id;
    return new Promise((ok, ko) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        ko(new Error(`${method}: nessuna risposta in ${timeout} ms`));
      }, timeout);
      this.pending.set(id, { method, ok: (r) => { clearTimeout(timer); ok(r); }, ko: (e) => { clearTimeout(timer); ko(e); } });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  on(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  async newPhone(opts) {
    const phone = new Phone(this, opts);
    await phone.init();
    return phone;
  }

  async close() {
    await this.send('browser.close', {}, 5000).catch(() => {});
    this.ws.close();
    await Promise.race([new Promise((ok) => this.proc.once('exit', ok)), sleep(5000)]);
    this.proc.kill('SIGKILL');
    rmSync(this.profile, { recursive: true, force: true });
  }
}

export async function launchFirefox({ downloads } = {}) {
  const bin = findFirefox();
  const version = spawnSync(bin, ['--version'], { encoding: 'utf8' }).stdout.trim();
  const profile = mkdtempSync(join(tmpdir(), 'cdv-e2e-firefox-'));
  writeFileSync(join(profile, 'user.js'), Object.entries(PREFS).map(([k, v]) => `user_pref(${JSON.stringify(k)}, ${JSON.stringify(v)});\n`).join(''));
  const proc = spawn(bin, ['--headless', '--no-remote', '--profile', profile, '--remote-debugging-port=0'], {
    stdio: ['ignore', 'ignore', 'pipe'],
    env: { ...process.env, MOZ_HEADLESS: '1' },
  });
  let log = '';
  const url = await new Promise((ok, ko) => {
    const timer = setTimeout(() => ko(new Error(`Firefox (${bin}) non ha aperto WebDriver BiDi in 30 s:\n${log.slice(-2000)}`)), TIMEOUT);
    proc.once('error', (e) => { clearTimeout(timer); ko(e); });
    proc.once('exit', (code) => { clearTimeout(timer); ko(new Error(`Firefox (${bin}) è uscito con codice ${code}:\n${log.slice(-2000)}`)); });
    proc.stderr.on('data', (d) => {
      log += d;
      const m = log.match(/WebDriver BiDi listening on (ws:\/\/\S+)/);
      if (m) { clearTimeout(timer); ok(m[1]); }
    });
  });
  const ws = new WebSocket(`${url}/session`);
  await new Promise((ok, ko) => { ws.onopen = ok; ws.onerror = () => ko(new Error(`connessione a ${url} fallita`)); });
  const ff = new Firefox(proc, ws, profile);
  // i dialoghi (confirm) restano aperti finché il test non risponde
  await ff.send('session.new', { capabilities: { alwaysMatch: { unhandledPromptBehavior: { default: 'ignore' } } } });
  await ff.send('session.subscribe', {
    events: ['log.entryAdded', 'network.beforeRequestSent', 'browsingContext.userPromptOpened', 'browsingContext.downloadEnd'],
  });
  if (downloads) await ff.send('browser.setDownloadBehavior', { downloadBehavior: { type: 'allowed', destinationFolder: downloads } });
  ff.description = `${version} (${bin})`;
  return ff;
}

// Converte un argomento in LocalValue BiDi passando da JSON: basta per i dati dei test.
const jsonArg = (arg) => ({ type: 'string', value: JSON.stringify(arg === undefined ? null : arg) });

// Un "telefono": contesto utente isolato (dati, cache e service worker suoi), una scheda, viewport mobile.
class Phone {
  constructor(ff, { viewport, locale = 'it-IT' }) {
    this.ff = ff;
    this.viewport = viewport;
    this.locale = locale;
    this.errors = [];
    this.external = [];
    this.net = { offline: false };
    this.routes = [];
    this.dialogHandlers = [];
    this.intercepts = [];
  }

  async init() {
    const { ff } = this;
    this.userContext = (await ff.send('browser.createUserContext')).userContext;
    this.context = (await ff.send('browsingContext.create', { type: 'tab', userContext: this.userContext })).context;
    await ff.send('browsingContext.setViewport', { context: this.context, viewport: this.viewport, devicePixelRatio: 2 });
    await ff.send('emulation.setLocaleOverride', { contexts: [this.context], locale: this.locale });
    await ff.send('script.addPreloadScript', {
      userContexts: [this.userContext],
      functionDeclaration: `() => {
        window.__csp = [];
        document.addEventListener('securitypolicyviolation', (e) => window.__csp.push(e.violatedDirective + ' ' + e.blockedURI));
      }`,
    });
    this.off = ff.on((method, p) => this.onEvent(method, p));
  }

  onEvent(method, p) {
    if (method === 'log.entryAdded') {
      if (p.source?.context !== this.context) return;
      if (p.type === 'javascript' || (p.type === 'console' && p.level === 'error')) this.errors.push(p.text);
    } else if (method === 'network.beforeRequestSent') {
      if (p.context !== this.context) return;
      const u = new URL(p.request.url);
      if (u.hostname !== 'localhost' && u.hostname !== '127.0.0.1') {
        this.external.push(`${p.request.method} ${u.hostname}${u.pathname}${p.request.bodySize ? ' BODY' : ''}`);
      }
      if (p.isBlocked) this.handleRoute(p.request);
    } else if (method === 'browsingContext.userPromptOpened') {
      if (p.context !== this.context) return;
      const fn = this.dialogHandlers.shift();
      const answer = (accept) => this.ff.send('browsingContext.handleUserPrompt', { context: this.context, accept }).catch(() => {});
      if (fn) fn({ message: p.message, accept: () => answer(true), dismiss: () => answer(false) });
      else answer(false); // come Playwright: un dialogo non previsto si chiude con "Annulla"
    } else if (method === 'browsingContext.downloadEnd') {
      if (p.context !== this.context) return;
      this.lastDownload = p;
      this.downloadWaiter?.(p);
    }
  }

  // Risposta simulata per le richieste verso `hostname`: handler(url) → oggetto JSON.
  async route(hostname, handler) {
    const { intercept } = await this.ff.send('network.addIntercept', {
      phases: ['beforeRequestSent'],
      contexts: [this.context],
      urlPatterns: [{ type: 'pattern', protocol: 'https', hostname }],
    });
    this.intercepts.push(intercept);
    this.routes.push({ hostname, handler });
  }

  async handleRoute(request) {
    const u = new URL(request.url);
    const route = this.routes.find((r) => r.hostname === u.hostname);
    try {
      if (!route || this.net.offline) {
        await this.ff.send('network.failRequest', { request: request.request });
        return;
      }
      const body = JSON.stringify(route.handler(u));
      await this.ff.send('network.provideResponse', {
        request: request.request,
        statusCode: 200,
        reasonPhrase: 'OK',
        headers: [
          { name: 'Content-Type', value: { type: 'string', value: 'application/json' } },
          { name: 'Access-Control-Allow-Origin', value: { type: 'string', value: '*' } },
        ],
        body: { type: 'string', value: body },
      });
    } catch (e) {
      this.errors.push(`simulazione di ${request.url}: ${e.message}`);
    }
  }

  async setOffline(offline) {
    this.net.offline = offline;
    await this.ff.send('emulation.setNetworkConditions', { contexts: [this.context], networkConditions: offline ? { type: 'offline' } : null });
  }

  onceDialog(fn) {
    this.dialogHandlers.push(fn);
  }

  goto(url) {
    return this.ff.send('browsingContext.navigate', { context: this.context, url, wait: 'complete' });
  }

  reload() {
    return this.ff.send('browsingContext.reload', { context: this.context, wait: 'complete' });
  }

  async title() {
    return this.evaluate(() => document.title);
  }

  // Esegue fn(arg) nella pagina; argomento e risultato passano come JSON.
  async evaluate(fn, arg) {
    const r = await this.ff.send('script.callFunction', {
      functionDeclaration: `async (a) => { const v = await (${fn})(JSON.parse(a)); return v === undefined ? 'null' : JSON.stringify(v); }`,
      arguments: [jsonArg(arg)],
      target: { context: this.context },
      awaitPromise: true,
    });
    if (r.type === 'exception') throw new Error(`nella pagina: ${r.exceptionDetails.text}`);
    return r.result.type === 'string' ? JSON.parse(r.result.value) : undefined;
  }

  async waitForFunction(fn, arg, { timeout = 10000 } = {}) {
    const end = Date.now() + timeout;
    let last;
    while (Date.now() < end) {
      try {
        if (await this.evaluate(fn, arg)) return;
      } catch (e) { last = e; } // durante un ricaricamento la pagina può non rispondere
      await sleep(100);
    }
    throw new Error(`attesa scaduta (${timeout} ms): ${String(fn).slice(0, 120)}${last ? ' — ' + last.message : ''}`);
  }

  waitForTimeout(ms) {
    return sleep(ms);
  }

  waitForSelector(sel, { state = 'visible', timeout = 10000 } = {}) {
    return this.waitForFunction(({ sel, state }) => {
      const el = document.querySelector(sel);
      return state === 'attached' ? !!el : !!el && el.checkVisibility();
    }, { sel, state }, { timeout });
  }

  locator(sel, opts) {
    return new Locator(this, sel, opts);
  }

  // Tocco come un dito: aspetta che l'elemento sia visibile, abilitato e non coperto (es. dall'avviso con
  // «Annulla», che resta 6 s sulla riga dell'importo), poi tap al centro.
  async tap(sel, { hasText, timeout = 10000 } = {}) {
    let box;
    await this.waitForFunction(({ sel, hasText }) => {
      const el = [...document.querySelectorAll(sel)].find((e) => !hasText || e.innerText.includes(hasText));
      if (!el || !el.checkVisibility() || el.disabled) return false;
      el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
      const r = el.getBoundingClientRect();
      const x = r.left + r.width / 2;
      const y = r.top + r.height / 2;
      const hit = document.elementFromPoint(x, y);
      return !!hit && (hit === el || el.contains(hit)) && (window.__tapPoint = { x: Math.round(x), y: Math.round(y) });
    }, { sel, hasText }, { timeout }).catch((e) => { throw new Error(`tap su ${sel}${hasText ? ` («${hasText}»)` : ''}: ${e.message}`); });
    box = await this.evaluate(() => window.__tapPoint);
    await this.ff.send('input.performActions', {
      context: this.context,
      actions: [{
        type: 'pointer',
        id: 'dito',
        parameters: { pointerType: 'touch' },
        actions: [
          { type: 'pointerMove', x: box.x, y: box.y },
          { type: 'pointerDown', button: 0 },
          { type: 'pointerUp', button: 0 },
        ],
      }],
    });
    await this.ff.send('input.releaseActions', { context: this.context }).catch(() => {});
  }

  // Come fill/selectOption di Playwright: imposta il valore e genera input + change.
  async fill(sel, value) {
    await this.waitForSelector(sel, { timeout: 5000 });
    await this.evaluate(({ sel, value }) => {
      const el = document.querySelector(sel);
      el.focus();
      el.value = value;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }, { sel, value });
  }

  async selectOption(sel, value) {
    await this.waitForSelector(sel, { timeout: 5000 });
    const ok = await this.evaluate(({ sel, value }) => {
      const el = document.querySelector(sel);
      if (![...el.options].some((o) => o.value === value)) return false;
      el.focus();
      el.value = value;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    }, { sel, value });
    if (!ok) throw new Error(`${sel}: nessuna opzione con valore «${value}»`);
  }

  async screenshot({ path, fullPage = false }) {
    const { data } = await this.ff.send('browsingContext.captureScreenshot', { context: this.context, origin: fullPage ? 'document' : 'viewport' });
    writeFileSync(path, Buffer.from(data, 'base64'));
  }

  // Esegue action (es. tap su "Esporta") e restituisce il percorso del file scaricato.
  async download(action, dir, { timeout = 10000 } = {}) {
    const before = new Set(readdirSync(dir));
    const done = new Promise((ok) => { this.downloadWaiter = ok; });
    await action();
    const ev = await Promise.race([done, sleep(timeout).then(() => null)]);
    this.downloadWaiter = null;
    if (ev?.filepath) return ev.filepath;
    const added = readdirSync(dir).filter((f) => !before.has(f) && !f.endsWith('.part'));
    if (added.length) return join(dir, added[0]);
    throw new Error(`nessun file scaricato in ${timeout} ms`);
  }

  async close() {
    this.off?.();
    for (const intercept of this.intercepts) await this.ff.send('network.removeIntercept', { intercept }).catch(() => {});
    await this.ff.send('browsingContext.close', { context: this.context, promptUnload: false }).catch(() => {});
    await this.ff.send('browser.removeUserContext', { userContext: this.userContext }).catch(() => {});
  }
}

class Locator {
  constructor(page, sel, { hasText } = {}) {
    this.page = page;
    this.sel = sel;
    this.hasText = hasText;
  }

  run(fn) {
    return this.page.evaluate(
      new Function('a', `const els = [...document.querySelectorAll(a.sel)].filter((e) => !a.hasText || e.innerText.includes(a.hasText)); return (${fn})(els);`),
      { sel: this.sel, hasText: this.hasText },
    );
  }

  count() { return this.run((els) => els.length); }
  isVisible() { return this.run((els) => !!els[0] && els[0].checkVisibility()); }
  allInnerTexts() { return this.run((els) => els.map((e) => e.innerText)); }

  async innerText() {
    const t = await this.run((els) => (els[0] ? els[0].innerText : null));
    if (t === null) throw new Error(`${this.sel}: elemento assente`);
    return t;
  }

  async inputValue() {
    const v = await this.run((els) => (els[0] ? els[0].value : null));
    if (v === null) throw new Error(`${this.sel}: elemento assente`);
    return v;
  }
}
