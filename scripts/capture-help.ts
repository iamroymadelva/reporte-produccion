/**
 * Genera las capturas del menú de ayuda (public/ayuda/*.png) con el Chrome real (DevTools Protocol, viewport móvil
 * 375x812, igual que la Fase 10: docs/qa/phase10/README.md) contra `astro dev` y el Supabase LOCAL, con los usuarios
 * sembrados (contraseña Planta2026!). Nunca usa .env.local ni producción.
 *
 * Requisitos: Docker + Supabase local arrancado y `bun run db:reset` hecho (datos de prueba limpios).
 *
 *   bun scripts/capture-help.ts              # arranca `bun run dev` (modo local seguro) en primer plano, captura y lo detiene
 *   BASE=http://localhost:4321 bun scripts/capture-help.ts --no-server   # usa un servidor ya levantado
 *
 * Al terminar detiene el servidor (`bunx astro dev stop`). Variables: CHROME (ruta a chrome.exe), OUT (carpeta de salida).
 */
import { mkdirSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");
const BASE = process.env.BASE ?? "http://localhost:4321";
const baseHost = (() => { try { return new URL(BASE).hostname; } catch { return ""; } })();
if (baseHost !== "localhost" && baseHost !== "127.0.0.1") {
  console.error(`ERROR: BASE debe ser localhost o 127.0.0.1 (recibido: ${BASE}). Este script solo corre contra el entorno local.`);
  process.exit(1);
}
const OUT = process.env.OUT ?? join(ROOT, "public", "ayuda");
const PASSWORD = "Planta2026!";
const CHROME = process.env.CHROME ?? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const DEBUG_PORT = 9333;
const useServer = !process.argv.includes("--no-server");

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// ------------------------------------------------------------------ servidor de desarrollo local
let server: ReturnType<typeof Bun.spawn> | null = null;
async function startServer() {
  const probe = await fetch(`${BASE}/iniciar-sesion`).then((r) => r.ok, () => false);
  if (probe) throw new Error(`Ya hay algo escuchando en ${BASE}; detenlo (bunx astro dev stop) o usa --no-server.`);
  server = Bun.spawn(["bun", "--no-env-file", "scripts/dev-local.ts"], { cwd: ROOT, stdio: ["ignore", "inherit", "inherit"] });
  for (let i = 0; i < 120; i += 1) {
    if (await fetch(`${BASE}/iniciar-sesion`).then((r) => r.ok, () => false)) return;
    await sleep(1000);
  }
  throw new Error("El servidor de desarrollo no respondió en 120 s.");
}
async function stopServer() {
  try { server?.kill(); } catch { /* ya terminó */ }
  const stop = Bun.spawn(["bunx", "astro", "dev", "stop"], { cwd: ROOT, stdio: ["ignore", "inherit", "inherit"] });
  await stop.exited;
}

// ------------------------------------------------------------------ cliente mínimo de DevTools Protocol
class Cdp {
  private id = 0;
  private pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>();
  private constructor(private ws: WebSocket) {
    ws.onmessage = (event) => {
      const msg = JSON.parse(String(event.data));
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id)!;
        this.pending.delete(msg.id);
        msg.error ? reject(new Error(`${msg.error.message}`)) : resolve(msg.result);
      }
    };
  }
  static async connect(url: string) {
    const ws = new WebSocket(url);
    await new Promise<void>((resolve, reject) => { ws.onopen = () => resolve(); ws.onerror = () => reject(new Error("No se pudo conectar a Chrome.")); });
    return new Cdp(ws);
  }
  send<T = any>(method: string, params: object = {}, sessionId?: string): Promise<T> {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params, sessionId }));
    });
  }
  close() { this.ws.close(); }
}

class Tab {
  constructor(private cdp: Cdp, private session: string) {}
  send<T = any>(method: string, params: object = {}) { return this.cdp.send<T>(method, params, this.session); }
  async eval<T = any>(expression: string): Promise<T> {
    const result = await this.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(`eval: ${result.exceptionDetails.exception?.description ?? result.exceptionDetails.text}`);
    return result.result.value as T;
  }
  async goto(path: string) {
    await this.send("Page.navigate", { url: `${BASE}${path}` });
    await sleep(600);
    await this.waitFor("document.readyState === 'complete'");
  }
  async waitFor(predicate: string, ms = 20_000) {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      try { if (await this.eval<boolean>(`Boolean(${predicate})`)) return; } catch { /* la página aún navega */ }
      await sleep(150);
    }
    throw new Error(`Tiempo agotado esperando: ${predicate}`);
  }
  /** Rellena un campo controlado por React (setter nativo + evento). */
  async setValue(selector: string, value: string) {
    await this.eval(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) throw new Error('No existe ${selector.replace(/'/g, "")}');
      const proto = el.tagName === 'SELECT' ? HTMLSelectElement.prototype : el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, ${JSON.stringify(value)});
      el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }));
    })()`);
  }
  /** Elige la primera opción con valor de un <select>. */
  async pickFirstOption(selector: string) {
    const value = await this.eval<string>(`[...document.querySelector(${JSON.stringify(selector)}).options].find((o) => o.value)?.value ?? ''`);
    if (!value) throw new Error(`Sin opciones en ${selector}`);
    await this.setValue(selector, value);
  }
  async clickButton(label: string, scope = "document") {
    await this.waitFor(`[...${scope}.querySelectorAll('button')].some((b) => b.textContent.trim() === ${JSON.stringify(label)} && !b.disabled)`);
    await this.eval(`[...${scope}.querySelectorAll('button')].find((b) => b.textContent.trim() === ${JSON.stringify(label)} && !b.disabled).click()`);
    await sleep(400);
  }
  async login(username: string) {
    await this.goto("/iniciar-sesion");
    await this.setValue('input[name="username"]', username);
    await this.setValue('input[name="password"]', PASSWORD);
    await this.eval(`document.querySelector('form[data-offline-login] button[type="submit"]').click()`);
    await this.waitFor(`!location.pathname.startsWith('/iniciar-sesion')`, 30_000);
    await sleep(1200);
  }
  /** Captura el viewport actual. */
  async shot(name: string) {
    await sleep(500);
    const { data } = await this.send("Page.captureScreenshot", { format: "png" });
    await save(name, data);
  }
  /** Captura el rectángulo (en coordenadas de documento) de un elemento, con un margen. */
  async shotElement(name: string, finder: string, opts: { pad?: number; maxHeight?: number; fromBottom?: number } = {}) {
    const pad = opts.pad ?? 8;
    const rect = await this.eval<{ x: number; y: number; width: number; height: number }>(`(() => {
      const el = (${finder});
      if (!el) throw new Error('Elemento no encontrado para ${name}');
      el.scrollIntoView({ block: 'start' });
      const r = el.getBoundingClientRect();
      return { x: r.left + scrollX, y: r.top + scrollY, width: r.width, height: r.height };
    })()`);
    await sleep(400);
    let { y, height } = rect;
    if (opts.fromBottom) { y = y + height - opts.fromBottom; height = opts.fromBottom; }
    if (opts.maxHeight && height > opts.maxHeight) height = opts.maxHeight;
    const clip = { x: Math.max(0, rect.x - pad), y: Math.max(0, y - pad), width: Math.min(375, rect.width + pad * 2), height: height + pad * 2, scale: 1 };
    const { data } = await this.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true, clip });
    await save(name, data);
  }
}

const cardByTitle = (title: string) => `[...document.querySelectorAll('h2')].find((h) => h.textContent.trim() === ${JSON.stringify(title)})?.closest('[data-slot="card"]')`;

async function save(name: string, base64: string) {
  const path = join(OUT, name);
  await Bun.write(path, Buffer.from(base64, "base64"));
  console.log(`captura ${name} (${Math.round(statSync(path).size / 1024)} KB)`);
}

// ------------------------------------------------------------------ guion
async function main() {
  mkdirSync(OUT, { recursive: true });
  if (useServer) await startServer();
  const userDataDir = mkdtempSync(join(tmpdir(), "capture-help-"));
  const chrome = Bun.spawn([CHROME, "--headless=new", `--remote-debugging-port=${DEBUG_PORT}`, `--user-data-dir=${userDataDir}`, "--no-first-run", "--no-default-browser-check", "--disable-gpu", "--hide-scrollbars", "about:blank"], { stdio: ["ignore", "ignore", "ignore"] });
  try {
    let wsUrl = "";
    for (let i = 0; i < 40 && !wsUrl; i += 1) {
      wsUrl = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/version`).then((r) => r.json()).then((j: any) => j.webSocketDebuggerUrl, () => "");
      if (!wsUrl) await sleep(250);
    }
    if (!wsUrl) throw new Error("Chrome no abrió el puerto de depuración.");
    const cdp = await Cdp.connect(wsUrl);

    const newTab = async () => {
      const { browserContextId } = await cdp.send("Target.createBrowserContext"); // cookies aisladas por rol
      const { targetId } = await cdp.send("Target.createTarget", { url: "about:blank", browserContextId });
      const { sessionId } = await cdp.send("Target.attachToTarget", { targetId, flatten: true });
      const tab = new Tab(cdp, sessionId);
      await tab.send("Page.enable");
      await tab.send("Emulation.setDeviceMetricsOverride", { width: 375, height: 812, deviceScaleFactor: 1, mobile: true });
      await tab.send("Emulation.setLocaleOverride", { locale: "es-CO" }).catch(() => undefined);
      await tab.send("Emulation.setTimezoneOverride", { timezoneId: "America/Bogota" }).catch(() => undefined);
      // Oculta la barra de desarrollo de Astro en todas las páginas (antes de que se pinte).
      await tab.send("Page.addScriptToEvaluateOnNewDocument", { source: `(() => { const css = 'astro-dev-toolbar{display:none !important}'; const add = () => { const st = document.createElement('style'); st.textContent = css; (document.head || document.documentElement).appendChild(st); }; if (document.documentElement) add(); else document.addEventListener('DOMContentLoaded', add); })()` });
      await tab.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "light" }] });
      return tab;
    };

    // --- Inicio de sesión (sin sesión)
    const anon = await newTab();
    await anon.goto("/iniciar-sesion");
    await anon.shot("login.png");

    // --- Operario: un turno completo con datos de prueba
    const op = await newTab();
    await op.login("op1");
    await op.goto("/turno");
    await op.waitFor(`document.querySelector('[data-testid="machine-select"]')`);
    await op.pickFirstOption('[data-testid="machine-select"]');
    await op.shotElement("turno-iniciar.png", cardByTitle("Iniciar reporte"));
    await op.clickButton("Iniciar reporte");
    await op.waitFor(`document.querySelector('[data-testid="start-category"]')`);

    await op.clickButton("Iniciar parada");
    await op.waitFor(`document.querySelector('[data-testid="stop-category"]')`);
    await sleep(2200); // que el cronómetro muestre algunos segundos
    await op.shotElement("turno-paradas.png", cardByTitle("Paradas de máquina"), { maxHeight: 560 });
    await op.pickFirstOption('[data-testid="stop-category"]');
    await op.clickButton("Cerrar parada");
    await op.waitFor(`document.querySelector('[data-testid="start-category"]')`);

    await op.pickFirstOption('[data-testid="change-type"]');
    await op.setValue('[data-testid="change-description"]', "De lote 120 a lote 121");
    await sleep(300);
    await op.shotElement("turno-cambios.png", cardByTitle("Cambios"));
    await op.clickButton("Registrar cambio");
    await sleep(600);

    // Datos de producción (todos los campos obligatorios).
    const selectors: Array<[string, "option" | string]> = [
      ["product_name", "option"], ["production_order", "OP-2041"], ["line_id", "option"], ["client_name", "option"], ["lot", "121"],
      ["weight", "250"], ["g_min", "40"], ["dosifier_type_id", "option"], ["started_at", ""], ["ended_at", ""],
      ["programmed_hours", "8"], ["units_produced", "1200"], ["waste", "3"],
    ];
    const day = await op.eval<string>(`new Date().toISOString().slice(0, 10)`);
    for (const [field, value] of selectors) {
      const selector = `[data-report-field="${field}"]`;
      if (value === "option") await op.pickFirstOption(selector);
      else if (field === "started_at") await op.setValue(selector, `${day}T06:00`);
      else if (field === "ended_at") await op.setValue(selector, `${day}T14:00`);
      else await op.setValue(selector, value);
    }
    await sleep(1200); // autoguardado
    await op.shotElement("turno-datos.png", cardByTitle("Datos de producción"), { maxHeight: 760 });
    await op.shotElement("turno-enviar.png", cardByTitle("Datos de producción"), { fromBottom: 150 });

    // Sin conexión: el aviso azul y el indicador.
    await op.send("Network.enable");
    await op.send("Network.emulateNetworkConditions", { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 });
    await op.eval(`window.dispatchEvent(new Event('offline'))`);
    await sleep(800);
    await op.eval(`window.scrollTo(0, 0)`);
    await op.eval(`(() => { const b = [...document.querySelectorAll('button[aria-expanded]')].find((x) => x.textContent.includes('¿Necesitas ayuda?')); if (b && b.getAttribute('aria-expanded') === 'false') b.click(); })()`);
    await sleep(500);
    await op.shot("turno-sin-conexion.png");
    await op.send("Network.emulateNetworkConditions", { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
    await op.eval(`window.dispatchEvent(new Event('online'))`);
    await sleep(800);

    // Enviar el reporte para que los demás roles tengan un reporte «Enviado».
    await op.clickButton("Enviar reporte");
    await op.waitFor(`document.querySelector('[role="alertdialog"]')`);
    await op.clickButton("Enviar reporte", `document.querySelector('[role="alertdialog"]')`);
    await op.waitFor(`document.body.textContent.includes('Reporte enviado')`, 30_000);

    // --- Coordinador
    const coord = await newTab();
    await coord.login("coord1");
    await coord.goto("/dashboard");
    await sleep(2500);
    await coord.shot("dashboard-coord.png");
    await coord.goto("/reportes");
    await sleep(1500);
    await coord.eval(`[...document.querySelectorAll('a')].find((a) => a.textContent.trim() === 'Exportar Excel')?.scrollIntoView({ block: 'center' })`);
    await coord.shot("reportes-coord.png");
    const detailHref = await coord.eval<string>(`document.querySelector('a[href^="/reportes/"]')?.getAttribute('href') ?? ''`);
    if (!detailHref) throw new Error("No hay reportes para abrir el detalle (¿falló el envío del operario?).");
    await coord.goto(detailHref);
    await sleep(1500);
    await coord.eval(`[...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Aprobar y cerrar')?.scrollIntoView({ block: 'center' })`);
    await coord.shot("reporte-detalle-coord.png");
    await coord.goto("/administracion/usuarios");
    await coord.shot("usuarios-coord.png");
    await coord.goto("/consulta-offline");
    await sleep(1500);
    await coord.shot("consulta-offline.png");

    // --- Auditor
    const auditor = await newTab();
    await auditor.login("auditor1");
    await auditor.goto(detailHref);
    await sleep(1500);
    await auditor.shot("reporte-detalle-auditor.png");

    // --- Raíz
    const root = await newTab();
    await root.login("root");
    await root.goto("/administracion/historial");
    await sleep(1500);
    await root.shot("historial-root.png");

    // Comprobación de /ayuda por rol: sin desbordamiento horizontal a 375 px y con todos los acordeones abiertos.
    for (const [label, tab] of [["op1", op], ["coord1", coord], ["auditor1", auditor], ["root", root]] as const) {
      await tab.goto("/ayuda");
      await tab.waitFor(`document.querySelector('[data-testid="help-accordion"] button[aria-expanded]')`);
      await tab.eval(`document.querySelectorAll('[data-testid="help-accordion"] button[aria-expanded="false"]').forEach((b) => b.click())`);
      await sleep(600);
      const report = await tab.eval<{ overflow: boolean; scrollWidth: number; tasks: number; images: number; broken: number }>(`(() => ({ overflow: document.documentElement.scrollWidth > innerWidth, scrollWidth: document.documentElement.scrollWidth, tasks: document.querySelectorAll('[data-task]').length, images: document.querySelectorAll('[data-task] img').length, broken: 0 }))()`);
      report.broken = await tab.eval<number>(`Promise.all([...document.querySelectorAll('[data-task] img')].map((i) => fetch(i.src).then((r) => (r.ok ? 0 : 1), () => 1))).then((l) => l.reduce((a, b) => a + b, 0))`);
      console.log(`/ayuda ${label}: ${JSON.stringify(report)}`);
      if (process.env.PREVIEW_DIR) { // vista previa opcional (no se guarda en public/)
        const height = await tab.eval<number>(`document.documentElement.scrollHeight`);
        const { data } = await tab.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true, clip: { x: 0, y: 0, width: 375, height: Math.min(height, 16000), scale: 1 } });
        await Bun.write(join(process.env.PREVIEW_DIR, `ayuda-${label}.png`), Buffer.from(data, "base64"));
      }
      if (report.overflow) throw new Error(`/ayuda desborda a 375 px para ${label}`);
      if (report.broken > 0) throw new Error(`/ayuda tiene imágenes rotas para ${label}`);
    }

    cdp.close();
  } finally {
    try { chrome.kill(); } catch { /* ya cerrado */ }
    await sleep(500);
    try { rmSync(userDataDir, { recursive: true, force: true }); } catch { /* Windows puede retener el perfil un instante */ }
    if (useServer) await stopServer();
  }
}

main().catch(async (error) => {
  console.error(`ERROR: ${error instanceof Error ? error.message : error}`);
  if (useServer) await stopServer();
  process.exit(1);
});
