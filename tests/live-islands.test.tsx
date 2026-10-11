/// <reference types="bun" />
// T101-T103: LiveReportList, PresenceList, LiveTimeline y la presencia del operario, con Realtime simulado.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { act } from "react";
import type { Root } from "react-dom/client";
import { FakeRealtimeClient, FakeTimers, flush } from "./helpers/fake-realtime";

const browser = new Window({ url: "http://localhost:4321/reportes?status=SUBMITTED" });
Object.assign(globalThis, {
  window: browser, document: browser.document, navigator: browser.navigator, HTMLElement: browser.HTMLElement,
  Event: browser.Event, CustomEvent: browser.CustomEvent, IS_REACT_ACT_ENVIRONMENT: true, Node: browser.Node, Element: browser.Element,
  MutationObserver: browser.MutationObserver, getComputedStyle: browser.getComputedStyle.bind(browser), DOMParser: browser.DOMParser,
});
const { createRoot } = await import("react-dom/client");
const { default: LiveReportList } = await import("../src/components/realtime/LiveReportList");
const { default: LiveTimeline } = await import("../src/components/realtime/LiveTimeline");
const { default: PresenceList } = await import("../src/components/realtime/PresenceList");
const { useOperatorPresence } = await import("../src/components/realtime/useOperatorPresence");
const { parseReportFilters } = await import("../src/lib/report-filters");

const realFetch = globalThis.fetch;
let requests: Array<{ url: string; init?: RequestInit }>;
let respond: (url: string) => Response;
let root: Root;
let container: HTMLDivElement;
let client: FakeRealtimeClient;
let timers: FakeTimers;

const mount = async (node: React.ReactNode) => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => { root.render(node); await flush(); });
};
const advance = async (ms: number) => { await act(async () => { timers.advance(ms); await flush(); }); };

beforeEach(() => {
  requests = [];
  client = new FakeRealtimeClient();
  timers = new FakeTimers();
  respond = () => new Response("{}", { status: 200 });
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => { requests.push({ url: String(input), init }); return respond(String(input)); }) as typeof fetch;
});
afterEach(async () => {
  await act(async () => { root.unmount(); });
  container.remove();
  globalThis.fetch = realFetch;
});

describe("LiveReportList (T101)", () => {
  const filters = parseReportFilters(new URLSearchParams("from=2026-10-10&to=2026-10-10&machine=3a000000-0000-0000-0000-000000000001"));
  const page = (rows: string) => `<html><body><div id="report-list-live">${rows}</div></body></html>`;

  const setup = async () => {
    document.body.innerHTML = "";
    const target = document.createElement("div");
    target.id = "report-list-live";
    target.innerHTML = "<p>viejo</p>";
    document.body.appendChild(target);
    respond = () => new Response(page("<p>nuevo</p>"), { status: 200 });
    await mount(<LiveReportList filters={filters} pageUrl="/reportes?status=SUBMITTED" realtime={{ client, timers }} />);
    await act(async () => { client.setAll("SUBSCRIBED"); });
    return target;
  };

  test("un evento que cumple los filtros refresca el listado tras 1 s, reemplazando solo el contenedor", async () => {
    const target = await setup();
    await act(async () => { client.byName("list-reports").emit({ new: { id: "r1", report_date: "2026-10-10", machine_id: "3a000000-0000-0000-0000-000000000001" } }); });
    await advance(999);
    expect(requests).toHaveLength(0);
    await advance(1);
    expect(requests).toHaveLength(1);
    expect(requests[0].url).toBe("/reportes?status=SUBMITTED");
    expect((requests[0].init?.headers as Record<string, string>).Accept).toBe("text/html");
    expect(requests[0].init?.cache).toBe("no-store");
    expect(target.innerHTML).toBe("<p>nuevo</p>");
  });

  test("un evento de otra máquina o de otra fecha no refresca", async () => {
    await setup();
    await act(async () => {
      client.byName("list-reports").emit({ new: { id: "r2", report_date: "2026-10-10", machine_id: "3a000000-0000-0000-0000-0000000000ff" } });
      client.byName("list-reports").emit({ new: { id: "r3", report_date: "2026-09-01", machine_id: "3a000000-0000-0000-0000-000000000001" } });
    });
    await advance(5000);
    expect(requests).toHaveLength(0);
  });

  test("una respuesta no válida (sesión vencida) deja el listado como estaba", async () => {
    const target = await setup();
    respond = () => new Response(null, { status: 302 });
    await act(async () => { client.byName("list-reports").emit(); });
    await advance(1000);
    expect(requests).toHaveLength(1);
    expect(target.innerHTML).toBe("<p>viejo</p>");
  });

  test("con el canal caído hace polling cada 8 s", async () => {
    await setup();
    await act(async () => { client.byName("list-stops").setStatus("CHANNEL_ERROR"); });
    expect(requests).toHaveLength(1);
    await advance(8000);
    expect(requests).toHaveLength(2);
  });
});

describe("LiveTimeline (T103)", () => {
  const auditRow = (id: number, reason: string | null): any => ({
    id, changed_at: `2026-10-10T10:0${id}:00Z`, changed_by: "u1", field_name: "observations", old_value: null, new_value: "x", entity_type: "report", entity_id: "r1",
    action: "UPDATE", actor_role: "ADMINISTRATOR", reason, captured_offline: false, captured_at: null, received_at: null, user: { full_name: "Coord Uno" },
  });
  const props = { reportId: "r1", initialAudit: [auditRow(1, "Primera")], initialStops: [], catalogs: {} };

  test("se suscribe por report_id (paradas, cambios, auditoría) y por id en reportes", async () => {
    await mount(<LiveTimeline {...props} realtime={{ client, timers }} />);
    const filters = client.channels.map((c) => c.handlers[0].filter as any);
    expect(filters.find((f) => f.table === "production_reports").filter).toBe("id=eq.r1");
    for (const table of ["report_stop_events", "report_change_events", "report_audit_log"]) expect(filters.find((f) => f.table === table).filter).toBe("report_id=eq.r1");
  });

  test("un evento re-pide la línea de tiempo y pinta la entrada nueva sin recargar", async () => {
    await mount(<LiveTimeline {...props} realtime={{ client, timers }} />);
    expect(container.querySelectorAll("[data-audit-entry]")).toHaveLength(1);
    respond = () => new Response(JSON.stringify({ report: {}, stops: [], changes: [], audit: [auditRow(1, "Primera"), auditRow(2, "Corrección del coordinador")] }), { status: 200 });
    await act(async () => { client.setAll("SUBSCRIBED"); client.byName("timeline-audit-r1").emit({ new: { id: 2 } }); });
    await advance(500);
    expect(requests).toHaveLength(1);
    expect(requests[0].url).toBe("/api/reports/r1/timeline");
    expect(container.querySelectorAll("[data-audit-entry]")).toHaveLength(2);
    expect(container.textContent).toContain("Corrección del coordinador");
  });

  test("sin Realtime, polling cada 8 s; un fallo muestra aviso y conserva lo mostrado", async () => {
    respond = () => new Response("{}", { status: 500 });
    await mount(<LiveTimeline {...props} realtime={{ client, timers }} />);
    await advance(5000);
    expect(requests).toHaveLength(1);
    expect(container.querySelector("[role=alert]")?.textContent).toContain("No fue posible actualizar el historial");
    expect(container.querySelectorAll("[data-audit-entry]")).toHaveLength(1);
    await advance(8000);
    expect(requests).toHaveLength(2);
  });

  test("al desmontar libera los cuatro canales", async () => {
    await mount(<LiveTimeline {...props} realtime={{ client, timers }} />);
    await act(async () => { root.unmount(); });
    root = createRoot(container);
    expect(client.removedNames).toHaveLength(4);
    expect(timers.pending).toBe(0);
  });
});

describe("PresenceList (T102)", () => {
  const operators = [{ id: "u1", fullName: "Ana" }, { id: "u2", fullName: "Beto" }, { id: "u3", fullName: "Carla" }];
  const meta = (userId: string, pendingCount: number, lastSeen = "2026-10-10T15:00:00Z") => ({ userId, fullName: userId, pendingCount, lastSeen });
  const status = (id: string) => container.querySelector(`[data-operator-id="${id}"]`)?.getAttribute("data-presence");

  test("En línea, En línea con pendientes y Sin conexión; solo escucha", async () => {
    await mount(<PresenceList operators={operators} client={client} />);
    const channel = client.byName("plant-presence");
    expect(channel.options).toEqual({ config: { private: true } });
    expect(operators.map((o) => status(o.id))).toEqual(["OFFLINE", "OFFLINE", "OFFLINE"]);
    await act(async () => { channel.setStatus("SUBSCRIBED"); channel.sync({ a: [meta("u1", 0)], b: [meta("u2", 4)] }); });
    expect(status("u1")).toBe("ONLINE");
    expect(status("u2")).toBe("ONLINE_PENDING");
    expect(status("u3")).toBe("OFFLINE");
    expect(container.textContent).toContain("En línea con pendientes");
    expect(container.textContent).toContain("Sin conexión");
    expect(channel.tracked).toHaveLength(0);
  });

  test("quien se va queda 'Sin conexión' con su última vez", async () => {
    await mount(<PresenceList operators={operators} client={client} />);
    const channel = client.byName("plant-presence");
    await act(async () => { channel.sync({ a: [meta("u1", 0, "2026-10-10T15:00:00Z")] }); });
    expect(status("u1")).toBe("ONLINE");
    await act(async () => { channel.sync({}); });
    expect(status("u1")).toBe("OFFLINE");
    expect(container.querySelector('[data-operator-id="u1"]')?.textContent).toContain("Última vez");
  });

  test("si el canal no autoriza, avisa y el resto sigue", async () => {
    await mount(<PresenceList operators={operators} client={client} />);
    await act(async () => { client.byName("plant-presence").setStatus("CHANNEL_ERROR"); });
    expect(container.textContent).toContain("La presencia no está disponible");
  });

  test("al desmontar sale del canal", async () => {
    await mount(<PresenceList operators={operators} client={client} />);
    await act(async () => { root.unmount(); });
    root = createRoot(container);
    expect(client.byName("plant-presence").removed).toBe(true);
  });
});

describe("useOperatorPresence (T102)", () => {
  function Probe(props: { pendingCount: number; enabled?: boolean }) {
    useOperatorPresence({ userId: "op1", fullName: "Operario Uno", pendingCount: props.pendingCount }, { client, timers, enabled: props.enabled });
    return null;
  }

  test("hace track con el payload del contrato, al cambiar valores y cada 30 s", async () => {
    await mount(<Probe pendingCount={0} />);
    const channel = client.byName("plant-presence");
    expect(channel.options).toEqual({ config: { private: true, presence: { key: "op1" } } });
    await act(async () => { channel.setStatus("SUBSCRIBED"); });
    expect(channel.tracked).toHaveLength(1);
    expect(channel.tracked[0]).toMatchObject({ userId: "op1", fullName: "Operario Uno", pendingCount: 0 });
    expect(Object.keys(channel.tracked[0]).sort()).toEqual(["fullName", "lastSeen", "pendingCount", "userId"]);
    expect(Number.isNaN(Date.parse(String(channel.tracked[0].lastSeen)))).toBe(false);
    await act(async () => { root.render(<Probe pendingCount={2} />); await flush(); });
    expect(channel.tracked.at(-1)).toMatchObject({ pendingCount: 2 });
    const before = channel.tracked.length;
    await advance(30_000);
    expect(channel.tracked).toHaveLength(before + 1);
  });

  test("deshabilitado (sin conexión) no abre canal; al desmontar libera todo", async () => {
    await mount(<Probe pendingCount={0} enabled={false} />);
    expect(client.channels).toHaveLength(0);
    await act(async () => { root.render(<Probe pendingCount={0} />); await flush(); });
    expect(client.channels).toHaveLength(1);
    await act(async () => { root.unmount(); });
    root = createRoot(container);
    expect(client.byName("plant-presence").removed).toBe(true);
    expect(timers.pending).toBe(0);
  });
});
