/// <reference types="bun" />

import { beforeEach, describe, expect, mock, test } from "bun:test";

type Call = { table: string; method: string; args: unknown[] };
let calls: Call[];
let writeError: unknown;

function chain(table: string): any {
  const proxy: any = new Proxy({}, {
    get(_target, method: string) {
      if (method === "then") return (resolve: (value: unknown) => void) => resolve({ data: null, error: writeError });
      return (...args: unknown[]) => { calls.push({ table, method, args }); return proxy; };
    },
  });
  return proxy;
}

mock.module("../src/lib/supabase/server", () => ({
  createSupabaseServerClient: () => ({ from: (table: string) => chain(table) }),
}));

const { POST } = await import("../src/pages/api/admin/machines");

const post = (role: string | null, fields: Record<string, string>) => {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) form.set(key, value);
  return Promise.resolve(POST({
    request: new Request("http://localhost:4321/api/admin/machines", { method: "POST", body: form }),
    cookies: {},
    locals: role ? { auth: { user: { id: "u1" }, profile: { id: "u1", role, active: true } } } : {},
    redirect: (url: string, status: number) => new Response(null, { status, headers: { Location: url } }),
  } as never)).then((response) => ({ response }));
};
const writes = () => calls.filter((c) => c.table === "machines" && (c.method === "insert" || c.method === "update"));
const written = () => writes()[0]?.args[0] as Record<string, unknown>;
const message = (response: Response) => decodeURIComponent((response.headers.get("Location") ?? "").replace(/\+/g, " "));

beforeEach(() => { calls = []; writeError = null; });

describe("POST /api/admin/machines · ubicación", () => {
  test("401 sin sesión y 403 para OPERATOR y VIEWER (sin escribir)", async () => {
    expect((await post(null, { code: "M1", name: "Uno" })).response.status).toBe(401);
    for (const role of ["OPERATOR", "VIEWER"]) expect((await post(role, { code: "M1", name: "Uno" })).response.status).toBe(403);
    expect(calls).toHaveLength(0);
  });

  test("ROOT y coordinador crean con la ubicación recortada", async () => {
    for (const role of ["ROOT", "ADMINISTRATOR"]) {
      calls = [];
      const { response } = await post(role, { code: "M1", name: "Uno", location: "  Planta 2, línea norte  " });
      expect(response.status).toBe(303);
      expect(message(response)).toContain("Máquina guardada.");
      expect(writes()[0].method).toBe("insert");
      expect(written().location).toBe("Planta 2, línea norte");
    }
  });

  test("ubicación vacía o solo espacios se guarda como null; al editar usa update", async () => {
    await post("ROOT", { code: "M1", name: "Uno", location: "   " });
    expect(written().location).toBeNull();
    calls = [];
    await post("ADMINISTRATOR", { id: "m-1", code: "M1", name: "Uno", location: "" });
    expect(writes()[0].method).toBe("update");
    expect(written().location).toBeNull();
  });

  test("120 caracteres es válido; 121 se rechaza con mensaje en español y no escribe", async () => {
    const ok = await post("ROOT", { code: "M1", name: "Uno", location: "x".repeat(120) });
    expect(message(ok.response)).toContain("Máquina guardada.");
    expect(String(written().location)).toHaveLength(120);
    calls = [];
    const bad = await post("ROOT", { code: "M1", name: "Uno", location: "x".repeat(121) });
    expect(bad.response.status).toBe(303);
    expect(message(bad.response)).toContain("La ubicación no puede superar 120 caracteres.");
    expect(writes()).toHaveLength(0);
  });

  test("el recorte se aplica antes de medir el límite (120 + espacios es válido)", async () => {
    const result = await post("ROOT", { code: "M1", name: "Uno", location: ` ${"x".repeat(120)} ` });
    expect(message(result.response)).toContain("Máquina guardada.");
  });
});

describe("pantalla de máquinas, detalle y marca (fuente)", () => {
  const read = (path: string) => Bun.file(new URL(path, import.meta.url)).text();

  test("maquinas.astro: campo Ubicación al crear y editar, columna y búsqueda por ubicación", async () => {
    const source = await read("../src/pages/administracion/maquinas.astro");
    expect(source.match(/name="location"/g)!.length).toBeGreaterThanOrEqual(3); // crear, editar, oculto del toggle
    expect(source).toContain("Ej.: Planta 2, línea norte");
    expect(source).toContain("<TableHead>Ubicación</TableHead>");
    expect(source).toContain("maxLength={120}");
    expect(source).toMatch(/data-search-text=\{`[^`]*machine\.location/);
    expect(source).toContain("description, location, active");
  });

  test("la auditoría etiqueta la columna location", async () => {
    expect(await read("../src/lib/admin-audit.ts")).toContain('location: "Ubicación"');
  });

  test("detalle del reporte consulta y muestra la ubicación", async () => {
    const source = await read("../src/pages/reportes/[id].astro");
    expect(source).toContain("machine:machines(id, code, name, location)");
    expect(source).toContain("report.machine.location");
  });

  test("AppShell: marca REGPRO sin el texto «Planta»", async () => {
    const source = await read("../src/components/shell/AppShell.tsx");
    expect(source).toContain('aria-label="REGPRO, ir al dashboard"');
    expect(source).toMatch(/data-testid="brand-name"[^>]*>REGPRO</);
    expect(source).not.toContain(">Planta<");
  });
});
