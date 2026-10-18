/// <reference types="bun" />
import { beforeEach, describe, expect, mock, test } from "bun:test";

// POST /api/account/preferences: preferencia de formato de hora en user_metadata del PROPIO usuario.
let updateCalls: Array<{ data?: Record<string, unknown> }>;
let updateError: { message: string } | null;
let adminClientCreated: number;
mock.module("../src/lib/supabase/server", () => ({
  createSupabaseServerClient: () => ({
    auth: {
      updateUser: async (attributes: { data?: Record<string, unknown> }) => { updateCalls.push(attributes); return { data: { user: {} }, error: updateError }; },
    },
  }),
  createSupabaseAdminClient: () => { adminClientCreated += 1; throw new Error("no debe usarse la service role"); },
}));

const { POST } = await import("../src/pages/api/account/preferences");
const auth = { user: { id: "u1" }, profile: { id: "u1", full_name: "Op Uno", role: "OPERATOR", job_title: null, active: true } };

const call = (body: unknown, { locals = { auth }, origin }: { locals?: { auth: unknown }; origin?: string } = {}) => Promise.resolve(POST({
  request: new Request("http://localhost:4321/api/account/preferences", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(origin ? { Origin: origin } : {}) },
    body: typeof body === "string" ? body : JSON.stringify(body),
  }),
  cookies: {}, locals,
} as never));

beforeEach(() => { updateCalls = []; updateError = null; adminClientCreated = 0; });

describe("POST /api/account/preferences", () => {
  test("401 sin sesión y no toca Auth", async () => {
    const response = await call({ time_format: "12h" }, { locals: { auth: null } });
    expect(response.status).toBe(401);
    expect(updateCalls).toEqual([]);
  });

  test("422 si el valor no está en la lista cerrada (o falta)", async () => {
    for (const body of [{ time_format: "13h" }, { time_format: "" }, { time_format: 12 }, { time_format: null }, {}, [], "null"]) {
      const response = await call(body);
      expect(response.status).toBe(422);
    }
    expect(updateCalls).toEqual([]);
  });

  test("400 con JSON inválido", async () => {
    expect((await call("{no es json")).status).toBe(400);
    expect(updateCalls).toEqual([]);
  });

  test("403 con origen distinto (CSRF)", async () => {
    expect((await call({ time_format: "12h" }, { origin: "https://otro.example" })).status).toBe(403);
    expect(updateCalls).toEqual([]);
  });

  test("200 guarda solo time_format con la sesión del propio usuario (24h y 12h), sin caché", async () => {
    for (const value of ["12h", "24h"]) {
      const response = await call({ time_format: value }, { origin: "http://localhost:4321" });
      expect(response.status).toBe(200);
      expect(response.headers.get("Cache-Control")).toBe("private, no-store");
      expect(await response.json()).toEqual({ ok: true, time_format: value });
    }
    expect(updateCalls).toEqual([{ data: { time_format: "12h" } }, { data: { time_format: "24h" } }]);
  });

  test("no escribe la metadata de otro usuario ni campos extra: ignora id/rol del cuerpo y no usa la service role", async () => {
    const response = await call({ time_format: "12h", user_id: "otro", id: "otro", role: "ROOT", user_metadata: { role: "ROOT" }, data: { role: "ROOT" } });
    expect(response.status).toBe(200);
    // updateUser actúa sobre la sesión (cookies) del solicitante: no recibe ningún id y la carga es exactamente time_format.
    expect(updateCalls).toEqual([{ data: { time_format: "12h" } }]);
    expect(adminClientCreated).toBe(0);
  });

  test("500 con mensaje genérico si Auth falla", async () => {
    updateError = { message: "detalle interno" };
    const response = await call({ time_format: "12h" });
    expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).not.toContain("detalle interno");
  });
});
