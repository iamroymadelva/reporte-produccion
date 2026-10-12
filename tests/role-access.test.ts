/// <reference types="bun" />

import { beforeEach, describe, expect, mock, test } from "bun:test";

type Role = "ROOT" | "ADMINISTRATOR" | "VIEWER" | "OPERATOR";
const roles: Role[] = ["ROOT", "ADMINISTRATOR", "VIEWER", "OPERATOR"];
let currentRole: Role | null = null;

mock.module("astro:middleware", () => ({ defineMiddleware: (handler: unknown) => handler }));
mock.module("../src/lib/supabase/server", () => ({
  createSupabaseServerClient: () => ({
    auth: {
      getUser: async () => currentRole
        ? { data: { user: { id: `user-${currentRole}` } }, error: null }
        : { data: { user: null }, error: { message: "no session" } },
    },
    from: () => ({
      select: () => ({
        eq: () => ({
          single: async () => ({ data: { id: `user-${currentRole}`, full_name: "Prueba", role: currentRole, job_title: null, active: true }, error: null }),
        }),
      }),
    }),
  }),
}));

const { onRequest } = await import("../src/middleware");
const { GET: exportReports } = await import("../src/pages/api/reports/export");

type Outcome = "next" | "redirect" | "401" | "403";

async function run(pathname: string): Promise<{ outcome: Outcome; response: Response; location?: string }> {
  const url = new URL(`http://localhost:4321${pathname}`);
  const locals: Record<string, unknown> = {};
  const context = {
    url,
    request: new Request(url),
    cookies: {},
    locals,
    redirect: (path: string, status = 302) => new Response(null, { status, headers: { Location: path } }),
  };
  const response: Response = await (onRequest as any)(context, async () => new Response("ok", { status: 200 }));
  const location = response.headers.get("Location") ?? undefined;
  const outcome: Outcome = location ? "redirect" : response.status === 401 ? "401" : response.status === 403 ? "403" : "next";
  return { outcome, response, location };
}

// ruta -> roles permitidos (los demás reciben 403 en API o redirección en páginas)
const matrix: Array<{ path: string; api: boolean; allowed: Role[] }> = [
  { path: "/administracion", api: false, allowed: ["ROOT", "ADMINISTRATOR"] },
  { path: "/administracion/usuarios", api: false, allowed: ["ROOT", "ADMINISTRATOR"] },
  { path: "/administracion/tipos-cambio", api: false, allowed: ["ROOT", "ADMINISTRATOR"] },
  { path: "/administracion/historial", api: false, allowed: ["ROOT"] },
  { path: "/api/admin/users/abc", api: true, allowed: ["ROOT", "ADMINISTRATOR"] },
  { path: "/api/admin/catalogs/machines", api: true, allowed: ["ROOT", "ADMINISTRATOR"] },
  { path: "/api/admin/audit", api: true, allowed: ["ROOT"] },
  { path: "/turno", api: false, allowed: ["OPERATOR"] },
  { path: "/consulta-offline", api: false, allowed: ["ROOT", "ADMINISTRATOR", "VIEWER"] },
  { path: "/api/offline/overview", api: true, allowed: ["ROOT", "ADMINISTRATOR", "VIEWER"] },
  { path: "/api/dashboard/summary", api: true, allowed: ["ROOT", "ADMINISTRATOR", "VIEWER"] },
  { path: "/api/auth/session-info", api: true, allowed: roles },
  { path: "/reportes", api: false, allowed: roles },
  { path: "/ayuda", api: false, allowed: roles },
  { path: "/api/reports/export", api: true, allowed: roles },
];

beforeEach(() => { currentRole = null; });

describe("middleware: rol x ruta protegida", () => {
  for (const { path, api, allowed } of matrix) {
    for (const role of roles) {
      const expected: Outcome = allowed.includes(role) ? "next" : api ? "403" : "redirect";
      test(`${role} -> ${path}: ${expected}`, async () => {
        currentRole = role;
        const result = await run(path);
        expect(result.outcome).toBe(expected);
        expect(result.response.headers.get("Cache-Control")).toBe("private, no-store");
        if (expected === "redirect") expect(result.location).not.toBe("/iniciar-sesion");
      });
    }
  }

  test("sin sesión: API -> 401 JSON y páginas -> redirección a /iniciar-sesion", async () => {
    currentRole = null;
    for (const path of ["/api/admin/audit", "/api/admin/users/abc", "/api/reports/export"]) {
      const result = await run(path);
      expect(result.outcome).toBe("401");
    }
    for (const path of ["/administracion", "/administracion/historial", "/turno", "/consulta-offline", "/ayuda"]) {
      const result = await run(path);
      expect(result.outcome).toBe("redirect");
      expect(result.location).toBe("/iniciar-sesion");
    }
  });

  test("las rutas de recuperación e invitación por correo ya no son públicas", async () => {
    currentRole = null;
    for (const path of ["/recuperar-contrasena", "/auth/confirmar", "/api/auth/recovery"]) {
      expect((await run(path)).outcome).not.toBe("next");
    }
    for (const path of ["/iniciar-sesion", "/api/auth/login", "/api/auth/logout"]) {
      expect((await run(path)).outcome).toBe("next");
    }
  });

  test("Phase 8: /acceso-offline y /api/auth/session-info son públicas (la ruta decide 401/403); la consulta y su API siguen protegidas", async () => {
    currentRole = null;
    expect((await run("/acceso-offline")).outcome).toBe("next");
    expect((await run("/api/auth/session-info")).outcome).toBe("next");
    expect((await run("/api/offline/overview")).outcome).toBe("401");
    expect((await run("/consulta-offline")).outcome).toBe("redirect");
  });
});

describe("GET /api/reports/export por rol", () => {
  const callExport = async (role: Role | null) => {
    const auth = role ? { user: { id: "u" }, profile: { id: "u", full_name: "x", role, job_title: null, active: true } } : null;
    const request = new Request("http://localhost:4321/api/reports/export");
    return (await exportReports({ request, cookies: {} as never, locals: { auth } } as never)) as Response;
  };

  test("OPERATOR recibe 403", async () => {
    const response = await callExport("OPERATOR");
    expect(response.status).toBe(403);
  });

  test("sin sesión recibe 401", async () => {
    expect((await callExport(null)).status).toBe(401);
  });
});
