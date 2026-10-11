/// <reference types="bun" />
import { beforeEach, describe, expect, mock, test } from "bun:test";

// GET /api/auth/session-info (Phase 8): identidad para matricular el verificador offline y revalidar al reconectar.
let user: { id: string } | null;
let profile: Record<string, unknown> | null;
mock.module("../src/lib/supabase/server", () => ({
  createSupabaseServerClient: () => ({
    auth: { getUser: async () => ({ data: { user }, error: user ? null : { message: "x" } }) },
    from: (table: string) => {
      const chain: any = new Proxy({}, {
        get: (_target, prop) => {
          if (prop === "then") return (resolve: (value: unknown) => void) => resolve({ data: table === "app_settings" ? [{ offline_login_window: "7 days" }] : [], error: null });
          if (prop === "single" || prop === "maybeSingle") {
            return () => Promise.resolve({ data: table === "app_settings" ? { offline_login_window: "7 days" } : profile, error: null });
          }
          return () => chain;
        },
      });
      return chain;
    },
  }),
}));

const { GET } = await import("../src/pages/api/auth/session-info");
const call = (auth: unknown) => Promise.resolve(GET({ request: new Request("http://localhost:4321/api/auth/session-info"), cookies: {}, locals: { auth } } as never));
const activeAuth = { user: { id: "u1", last_sign_in_at: "2026-10-10T12:00:00.000Z" }, profile: { id: "u1", full_name: "Op Uno", role: "OPERATOR", job_title: null, active: true } };

beforeEach(() => { user = null; profile = null; });

describe("GET /api/auth/session-info", () => {
  test("401 sin sesión", async () => {
    expect((await call(null)).status).toBe(401);
  });
  test("403 INACTIVE si la sesión es válida pero el perfil está inactivo", async () => {
    user = { id: "u1" }; profile = { id: "u1", username: "op1", full_name: "Op Uno", role: "OPERATOR", active: false };
    const response = await call(null);
    expect(response.status).toBe(403);
    expect((await response.json()).code).toBe("INACTIVE");
  });
  test("200 con identidad, rol y ventana offline para un usuario activo; sin cache", async () => {
    profile = { username: "op1" };
    const response = await call(activeAuth);
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(await response.json()).toMatchObject({ userId: "u1", username: "op1", fullName: "Op Uno", role: "OPERATOR", active: true, offlineLoginWindow: "7 days", signInAt: "2026-10-10T12:00:00.000Z" });
  });
});
