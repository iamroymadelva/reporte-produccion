/// <reference types="bun" />

import { beforeEach, describe, expect, mock, test } from "bun:test";

const GENERIC = "Usuario o contraseña incorrectos";

type State = {
  allowed: boolean;
  resolvedEmail: string;
  signInError: { message: string } | null;
  profileActive: boolean | null;
  rpcCalls: Array<{ name: string; args: Record<string, unknown> }>;
  signInCalls: Array<{ email: string; password: string }>;
  signOutCalls: number;
};

const state: State = {
  allowed: true, resolvedEmail: "op1@usuarios.reporte-produccion.invalid", signInError: null,
  profileActive: true, rpcCalls: [], signInCalls: [], signOutCalls: 0,
};

mock.module("../src/lib/supabase/server", () => ({
  createSupabaseAdminClient: () => ({
    rpc: async (name: string, args: Record<string, unknown>) => {
      state.rpcCalls.push({ name, args });
      if (name === "login_check_allowed") return { data: state.allowed, error: null };
      if (name === "resolve_login_email") return { data: state.resolvedEmail, error: null };
      return { data: null, error: null };
    },
  }),
  createSupabaseServerClient: () => ({
    auth: {
      signInWithPassword: async (credentials: { email: string; password: string }) => {
        state.signInCalls.push(credentials);
        return state.signInError
          ? { data: { user: null }, error: state.signInError }
          : { data: { user: { id: "u1" } }, error: null };
      },
      signOut: async () => { state.signOutCalls++; return { error: null }; },
    },
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: state.profileActive === null ? null : { active: state.profileActive }, error: null }) }) }),
    }),
  }),
}));

const { POST } = await import("../src/pages/api/auth/login");

async function login(fields: Record<string, string>) {
  const body = new URLSearchParams(fields);
  const request = new Request("http://localhost:4321/api/auth/login", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body,
  });
  const redirect = (location: string, status = 302) => new Response(null, { status, headers: { Location: location } });
  return (await POST({ request, cookies: {} as never, redirect } as never)) as Response;
}

function errorOf(response: Response) {
  return new URL(response.headers.get("Location")!, "http://local").searchParams.get("error");
}

function resultsRegistered() {
  return state.rpcCalls.filter((call) => call.name === "login_register_result").map((call) => call.args.p_success);
}

beforeEach(() => {
  state.allowed = true;
  state.resolvedEmail = "op1@usuarios.reporte-produccion.invalid";
  state.signInError = null;
  state.profileActive = true;
  state.rpcCalls = [];
  state.signInCalls = [];
  state.signOutCalls = 0;
});

describe("POST /api/auth/login", () => {
  test("contraseña incorrecta: mensaje genérico y fallo registrado", async () => {
    state.signInError = { message: "Invalid login credentials" };
    const response = await login({ username: "op1", password: "mala" });
    expect(response.status).toBe(303);
    expect(response.headers.get("Location")).toStartWith("/iniciar-sesion");
    expect(errorOf(response)).toBe(GENERIC);
    expect(response.headers.get("X-Offline-Enroll")).toBeNull();
    expect(resultsRegistered()).toEqual([false]);
  });

  test("usuario inexistente: el mismo mensaje y también se registra el fallo", async () => {
    state.resolvedEmail = "fantasma@usuarios.reporte-produccion.invalid";
    state.signInError = { message: "Invalid login credentials" };
    const response = await login({ username: "Fantasma", password: "x" });
    expect(errorOf(response)).toBe(GENERIC);
    expect(state.signInCalls[0].email).toBe("fantasma@usuarios.reporte-produccion.invalid");
    expect(resultsRegistered()).toEqual([false]);
  });

  test("usuario bloqueado: mismo mensaje y NO se intenta signInWithPassword", async () => {
    state.allowed = false;
    const response = await login({ username: "op1", password: "Planta2026!" });
    expect(errorOf(response)).toBe(GENERIC);
    expect(state.signInCalls).toHaveLength(0);
    expect(resultsRegistered()).toEqual([]);
  });

  test("usuario inactivo con contraseña correcta: cierra la sesión, cuenta como fallo y usa el mismo mensaje", async () => {
    state.profileActive = false;
    const response = await login({ username: "op1", password: "Planta2026!" });
    expect(errorOf(response)).toBe(GENERIC);
    expect(state.signOutCalls).toBe(1);
    expect(resultsRegistered()).toEqual([false]);
    expect(response.headers.get("X-Offline-Enroll")).toBeNull();
  });

  test("campos vacíos: mismo mensaje sin llamar a Auth", async () => {
    const response = await login({ username: "", password: "" });
    expect(errorOf(response)).toBe(GENERIC);
    expect(state.signInCalls).toHaveLength(0);
  });

  test("todos los modos de fallo producen exactamente el mismo mensaje", async () => {
    const messages: Array<string | null> = [];
    state.signInError = { message: "Invalid login credentials" };
    messages.push(errorOf(await login({ username: "op1", password: "mala" })));
    state.signInError = null; state.allowed = false;
    messages.push(errorOf(await login({ username: "op1", password: "x" })));
    state.allowed = true; state.profileActive = false;
    messages.push(errorOf(await login({ username: "op1", password: "x" })));
    expect(new Set(messages)).toEqual(new Set([GENERIC]));
  });

  test("credenciales correctas: 303 a / con X-Offline-Enroll: 1 y éxito registrado", async () => {
    const response = await login({ username: "  OP1 ", password: "Planta2026!" });
    expect(response.status).toBe(303);
    expect(response.headers.get("Location")).toBe("/");
    expect(response.headers.get("X-Offline-Enroll")).toBe("1");
    expect(state.rpcCalls.find((call) => call.name === "login_check_allowed")!.args).toEqual({ p_username: "op1" });
    expect(state.signInCalls).toEqual([{ email: "op1@usuarios.reporte-produccion.invalid", password: "Planta2026!" }]);
    expect(resultsRegistered()).toEqual([true]);
  });

  test("usa el correo real devuelto por resolve_login_email", async () => {
    state.resolvedEmail = "real.person@empresa.com";
    await login({ username: "persona.real", password: "Planta2026!" });
    expect(state.signInCalls[0].email).toBe("real.person@empresa.com");
  });
});
