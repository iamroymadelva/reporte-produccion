/// <reference types="bun" />

import { beforeEach, describe, expect, mock, test } from "bun:test";

type Call = [string, ...unknown[]];
let rpcCalls: unknown[] = [];
let userCalls: Call[] = [];
let sessionRpcCalls: unknown[] = [];
let targetRole = "OPERATOR";
let targetActive: boolean | undefined = undefined;
let targetRemovedAt: string | null = null;
let existingUsername: { id: string; active: boolean; removed_at: string | null } | null = null;
let rpcError: { code?: string; message: string } | null = null;
let sessionRpcResult: { data: unknown; error: { code?: string; message: string } | null } = { data: null, error: null };
let createUserError: { message: string } | null = null;

const fakeAdmin = () => ({
  from: () => ({
    select: () => ({
      eq: (column: string) => ({
        maybeSingle: async () => column === "username"
          ? { data: existingUsername, error: null }
          : { data: { role: targetRole, removed_at: targetRemovedAt, ...(targetActive === undefined ? {} : { active: targetActive }) }, error: null },
      }),
    }),
  }),
  rpc: async (...args: unknown[]) => { rpcCalls.push(args); return { error: rpcError }; },
  auth: { admin: {
    getUserById: async (id: string) => ({ data: { user: { id, email: "op@usuarios.reporte-produccion.invalid" } }, error: null }),
    updateUserById: async (...args: unknown[]) => { userCalls.push(["updateUserById", ...args]); return { error: null }; },
    createUser: async (...args: unknown[]) => { userCalls.push(["createUser", ...args]); return createUserError ? { data: { user: null }, error: createUserError } : { data: { user: { id: "new-user-id" } }, error: null }; },
    deleteUser: async (...args: unknown[]) => { userCalls.push(["deleteUser", ...args]); return { error: null }; },
    listUsers: async () => ({ data: { users: [] }, error: null }),
  } },
});
const fakeServerClient = () => ({
  rpc: async (...args: unknown[]) => { sessionRpcCalls.push(args); return sessionRpcResult; },
});
mock.module("../src/lib/supabase/server", () => ({ createSupabaseAdminClient: fakeAdmin, createSupabaseServerClient: fakeServerClient }));
const { POST } = await import("../src/pages/api/admin/users/[id]");
const { POST: createUser } = await import("../src/pages/api/admin/users/index");
const { GET: lastContact } = await import("../src/pages/api/admin/users/[id]/last-contact");
const { POST: deviceStatus } = await import("../src/pages/api/device-status");

const coordinator = { user: { id: "coord" }, profile: { id: "coord", role: "ADMINISTRATOR", active: true } };
const root = { user: { id: "root" }, profile: { id: "root", role: "ROOT", active: true } };
const redirect = (url: string, status = 302) => new Response(null, { status, headers: { Location: url } });
const call = (fields: Record<string, string>, auth: unknown = coordinator) => {
  const body = new URLSearchParams({ full_name: "Operario", email: "op@usuarios.reporte-produccion.invalid", ...fields });
  const request = new Request("http://localhost/api/admin/users/target", { method: "POST", body });
  return (POST as any)({ request, params: { id: "target" }, redirect, locals: { auth } }) as Promise<Response>;
};

const machineId = "30000000-0000-4000-8000-000000000001";
const shiftId = "20000000-0000-4000-8000-000000000001";
const create = (fields: Record<string, string | string[]>, auth: unknown = coordinator) => {
  const body = new URLSearchParams();
  const base = { username: "Nuevo.Op", full_name: "Operario Nuevo", role: "OPERATOR", password: "Segura123", password_confirm: "Segura123", ...fields };
  for (const [key, value] of Object.entries(base)) for (const item of Array.isArray(value) ? value : [value]) body.append(key, item);
  const request = new Request("http://localhost/api/admin/users", { method: "POST", body });
  return (createUser as any)({ request, redirect, locals: { auth } }) as Promise<Response>;
};
const location = (response: Response) => decodeURIComponent(response.headers.get("Location") ?? "").replace(/\+/g, " ");

beforeEach(() => {
  rpcCalls = []; userCalls = []; sessionRpcCalls = [];
  targetRole = "OPERATOR"; targetActive = undefined; targetRemovedAt = null; existingUsername = null; rpcError = null; createUserError = null;
  sessionRpcResult = { data: null, error: null };
});

describe("user administration role guard", () => {
  test("a coordinator cannot escalate an operator with an empty intent", async () => {
    for (const role of ["ADMINISTRATOR", "VIEWER"]) {
      const response = await call({ intent: "", role });
      expect(response.status === 400 || response.status === 303).toBe(true);
      expect(rpcCalls.length).toBe(0);
    }
  });
  test("a coordinator cannot set another role without an intent either", async () => {
    for (const role of ["ADMINISTRATOR", "VIEWER"]) {
      const response = await call({ role });
      expect(response.status).toBe(303);
      expect(rpcCalls.length).toBe(0);
    }
  });
  test("an unknown intent returns 400 and never calls the RPC", async () => {
    const response = await call({ intent: "foo", role: "OPERATOR" });
    expect(response.status).toBe(400);
    expect(rpcCalls.length).toBe(0);
  });
  test("a coordinator cannot manage a non-operator target", async () => {
    targetRole = "VIEWER";
    const response = await call({ intent: "remove", confirm_offline_risk: "1" });
    expect(response.status).toBe(303);
    expect(rpcCalls.length).toBe(0);
  });
  test("a coordinator can still update an operator keeping the operator role", async () => {
    const response = await call({ role: "OPERATOR", active: "on" });
    expect(response.status).toBe(303);
    expect(rpcCalls.length).toBe(1);
  });
  test("ROOT can set a non-operator role", async () => {
    const response = await call({ role: "VIEWER", active: "on" }, root);
    expect(response.status).toBe(303);
    expect(rpcCalls.length).toBe(1);
  });
});

describe("POST /api/admin/users (create)", () => {
  test("creates the auth user with a synthetic email and password, then assigns through manage_user_assignments", async () => {
    const response = await create({ assignments: [`${machineId}:${shiftId}`], valid_from: "2026-10-01" });
    expect(response.status).toBe(303);
    expect(location(response)).toContain("ok=");
    expect(userCalls[0]).toEqual(["createUser", {
      email: "nuevo.op@usuarios.reporte-produccion.invalid",
      password: "Segura123",
      email_confirm: true,
      user_metadata: { full_name: "Operario Nuevo", username: "nuevo.op" },
    }]);
    expect(rpcCalls.length).toBe(1);
    const [name, args] = rpcCalls[0] as [string, any];
    expect(name).toBe("manage_user_assignments");
    expect(args.p_target).toBe("new-user-id");
    expect(args.p_actor).toBe("coord");
    expect(args.p_profile).toMatchObject({ role: "OPERATOR", active: true, audit_action: "USER_CREATED", full_name: "Operario Nuevo" });
    expect(args.p_assignments).toEqual([{ machine_id: machineId, shift_id: shiftId, valid_from: "2026-10-01", valid_to: null }]);
    expect(JSON.stringify(rpcCalls)).not.toContain("Segura123");
  });
  test("rejects a duplicate username before creating anything", async () => {
    existingUsername = { id: "x", active: true, removed_at: null };
    const response = await create({});
    expect(response.status).toBe(303);
    expect(location(response)).toContain("Ya existe un usuario con este nombre de usuario");
    expect(userCalls.length).toBe(0);
    expect(rpcCalls.length).toBe(0);
  });
  test("tells to reactivate when the username belongs to a retired user", async () => {
    existingUsername = { id: "x", active: false, removed_at: "2026-01-01T00:00:00Z" };
    const response = await create({});
    expect(location(response)).toContain("Reactiva el usuario existente");
    expect(userCalls.length).toBe(0);
  });
  test("a coordinator creating an ADMINISTRATOR or VIEWER gets 403 and no auth user is created", async () => {
    for (const role of ["ADMINISTRATOR", "VIEWER", "ROOT"]) {
      const response = await create({ role });
      expect(response.status).toBe(403);
    }
    expect(userCalls.length).toBe(0);
    expect(rpcCalls.length).toBe(0);
  });
  test("ROOT can create a coordinator", async () => {
    const response = await create({ role: "ADMINISTRATOR", username: "coord2" }, root);
    expect(response.status).toBe(303);
    expect(userCalls[0]?.[0]).toBe("createUser");
    expect((rpcCalls[0] as any)[1].p_profile.role).toBe("ADMINISTRATOR");
    expect((rpcCalls[0] as any)[1].p_assignments).toEqual([]);
  });
  test("rejects invalid usernames, short passwords and mismatched confirmation", async () => {
    for (const fields of [{ username: "a" }, { username: "con espacio" }, { username: "Ñandú" }, { password: "corta", password_confirm: "corta" }, { password_confirm: "Distinta123" }] as Record<string, string>[]) {
      const response = await create(fields);
      expect(response.status).toBe(303);
      expect(location(response)).toContain("error=");
    }
    expect(userCalls.length).toBe(0);
  });
  test("deletes the auth user when the RPC fails (compensation)", async () => {
    rpcError = { code: "P0001", message: "Only active machines may be assigned" };
    const response = await create({ assignments: [`${machineId}:${shiftId}`] });
    expect(location(response)).toContain("error=");
    expect(userCalls.map(([name]) => name)).toEqual(["createUser", "deleteUser"]);
    expect(userCalls[1]).toEqual(["deleteUser", "new-user-id"]);
  });
  test("an operator or auditor session cannot create users", async () => {
    for (const role of ["OPERATOR", "VIEWER"]) {
      const response = await create({}, { user: { id: "u" }, profile: { id: "u", role, active: true } });
      expect(response.status).toBe(403);
    }
    expect(userCalls.length).toBe(0);
  });
});

describe("POST /api/admin/users/[id] intents", () => {
  test("reset_password updates the password and audits PASSWORD_RESET without sending the password to the RPC", async () => {
    const response = await call({ intent: "reset_password", password: "NuevaClave1", password_confirm: "NuevaClave1" });
    expect(response.status).toBe(303);
    expect(location(response)).toContain("ok=");
    expect(userCalls).toEqual([["updateUserById", "target", { password: "NuevaClave1" }]]);
    const [name, args] = rpcCalls[0] as [string, any];
    expect(name).toBe("manage_user_assignments");
    expect(args.p_profile).toEqual({ audit_action: "PASSWORD_RESET" });
    expect(args.p_assignments).toBeNull();
    expect(JSON.stringify(rpcCalls)).not.toContain("NuevaClave1");
  });
  test("reset_password rejects short or unconfirmed passwords and non-operator targets for a coordinator", async () => {
    expect((await call({ intent: "reset_password", password: "corta", password_confirm: "corta" })).status).toBe(303);
    expect((await call({ intent: "reset_password", password: "NuevaClave1", password_confirm: "Otra12345" })).status).toBe(303);
    expect(userCalls.length).toBe(0);
    targetRole = "VIEWER";
    await call({ intent: "reset_password", password: "NuevaClave1", password_confirm: "NuevaClave1" });
    expect(userCalls.length).toBe(0);
    expect(rpcCalls.length).toBe(0);
  });
  test("ROOT can reset the password of a non-operator", async () => {
    targetRole = "VIEWER";
    await call({ intent: "reset_password", password: "NuevaClave1", password_confirm: "NuevaClave1" }, root);
    expect(userCalls.length).toBe(1);
    expect(rpcCalls.length).toBe(1);
  });
  test("remove without confirm_offline_risk is rejected before banning or calling the RPC", async () => {
    const response = await call({ intent: "remove" });
    expect(response.status).toBe(303);
    expect(location(response)).toContain("Entiendo que puede haber datos");
    expect(userCalls.length).toBe(0);
    expect(rpcCalls.length).toBe(0);
  });
  test("deactivating through update without confirm_offline_risk is rejected", async () => {
    targetActive = true;
    const response = await call({ role: "OPERATOR" });
    expect(location(response)).toContain("Entiendo que puede haber datos");
    expect(rpcCalls.length).toBe(0);
  });
  test("remove with confirm_offline_risk calls the RPC with REMOVE_USER and clears assignments", async () => {
    const response = await call({ intent: "remove", confirm_offline_risk: "1" });
    expect(location(response)).toContain("ok=");
    const [, args] = rpcCalls[0] as [string, any];
    expect(args.p_profile).toMatchObject({ audit_action: "REMOVE_USER" });
    expect(args.p_assignments).toEqual([]);
  });
  test("USER_HAS_PENDING_DATA is translated and the access ban is reverted", async () => {
    rpcError = { code: "P0004", message: "USER_HAS_PENDING_DATA" };
    const response = await call({ intent: "remove", confirm_offline_risk: "1" });
    expect(location(response)).toContain("El usuario tiene datos pendientes de subir o un reporte activo");
    expect(userCalls.at(-1)).toEqual(["updateUserById", "target", { ban_duration: "none" }]);
  });
  test("update translates USER_HAS_PENDING_DATA too", async () => {
    rpcError = { code: "P0004", message: "USER_HAS_PENDING_DATA" };
    const response = await call({ role: "OPERATOR", confirm_offline_risk: "1" });
    expect(location(response)).toContain("El usuario tiene datos pendientes de subir o un reporte activo");
  });
  test("update no longer edits the email and sends assignments by machine and shift", async () => {
    const response = await call({ role: "OPERATOR", active: "on", assignments: `${machineId}:${shiftId}`, email: "otro@x.com" });
    expect(location(response)).toContain("ok=");
    expect(userCalls.length).toBe(0);
    const [, args] = rpcCalls[0] as [string, any];
    expect(args.p_profile).toMatchObject({ full_name: "Operario", role: "OPERATOR", active: true, audit_action: "UPDATE" });
    // Regresión: editar sin marcar "aplicar vigencia" no envía claves de vigencia (no altera las asignaciones conservadas).
    expect(args.p_assignments).toEqual([{ machine_id: machineId, shift_id: shiftId }]);
    expect(Object.keys(args.p_assignments[0])).toEqual(["machine_id", "shift_id"]);
  });
  test("editing only the name sends no validity keys even if date inputs are present but not opted in", async () => {
    await call({ role: "OPERATOR", active: "on", full_name: "Solo nombre", assignments: `${machineId}:${shiftId}`, valid_from: "2026-01-01", valid_to: "2026-02-01" });
    const [, args] = rpcCalls[0] as [string, any];
    expect(args.p_profile.full_name).toBe("Solo nombre");
    expect(args.p_assignments).toEqual([{ machine_id: machineId, shift_id: shiftId }]);
  });
  test("apply_validity=1 sends the explicit validity to every assignment", async () => {
    await call({ role: "OPERATOR", active: "on", assignments: `${machineId}:${shiftId}`, apply_validity: "1", valid_from: "2026-03-01", valid_to: "" });
    const [, args] = rpcCalls[0] as [string, any];
    expect(args.p_assignments).toEqual([{ machine_id: machineId, shift_id: shiftId, valid_from: "2026-03-01", valid_to: null }]);
  });
  test("update rejects a retired target so the form cannot reactivate it without unbanning", async () => {
    targetActive = false; targetRemovedAt = "2026-01-01T00:00:00Z";
    const response = await call({ role: "OPERATOR", active: "on" });
    expect(location(response)).toContain("El usuario está retirado. Usa Reactivar.");
    expect(rpcCalls.length).toBe(0);
  });
  test("a coordinator cannot reset or remove their own account or act as ROOT", async () => {
    const response = await call({ intent: "remove", confirm_offline_risk: "1" }, { ...coordinator, user: { id: "target" } });
    expect(rpcCalls.length).toBe(0);
    expect(response.status).toBe(303);
  });
});

describe("T113 force_reason", () => {
  test("ROOT forwards force_reason on remove and update", async () => {
    await call({ intent: "remove", confirm_offline_risk: "1", force_reason: "Dispositivo perdido, autorizado" }, root);
    expect((rpcCalls[0] as any)[1].p_profile).toEqual({ audit_action: "REMOVE_USER", force_reason: "Dispositivo perdido, autorizado" });
    rpcCalls = [];
    targetActive = true;
    await call({ role: "OPERATOR", confirm_offline_risk: "1", force_reason: "Dispositivo perdido, autorizado" }, root);
    expect((rpcCalls[0] as any)[1].p_profile.force_reason).toBe("Dispositivo perdido, autorizado");
  });
  test("without force_reason the profile carries no force key", async () => {
    await call({ intent: "remove", confirm_offline_risk: "1" }, root);
    expect("force_reason" in (rpcCalls[0] as any)[1].p_profile).toBe(false);
  });
  test("a coordinator sending force_reason is rejected with 403 and nothing is called", async () => {
    for (const fields of [{ intent: "remove", confirm_offline_risk: "1", force_reason: "Motivo suficientemente largo" }, { role: "OPERATOR", confirm_offline_risk: "1", force_reason: "Motivo suficientemente largo" }] as Record<string, string>[]) {
      const response = await call(fields);
      expect(response.status).toBe(403);
    }
    expect(rpcCalls.length).toBe(0);
    expect(userCalls.length).toBe(0);
  });
  test("short-reason RPC error is translated", async () => {
    rpcError = { code: "22023", message: "Force reason must have at least 10 characters" };
    const response = await call({ intent: "remove", confirm_offline_risk: "1", force_reason: "corto" }, root);
    expect(location(response)).toContain("al menos 10 caracteres");
  });
});

describe("GET /api/admin/users/[id]/last-contact", () => {
  const get = (auth: unknown = coordinator) => (lastContact as any)({ params: { id: "target" }, request: new Request("http://localhost/api/admin/users/target/last-contact"), cookies: {}, locals: { auth } }) as Promise<Response>;
  test("returns the RPC payload for a manager", async () => {
    sessionRpcResult = { data: { lastSeenAt: "2026-10-01T10:00:00Z", pendingCount: 2, activeReportId: null }, error: null };
    const response = await get();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ lastSeenAt: "2026-10-01T10:00:00Z", pendingCount: 2, activeReportId: null });
    expect(sessionRpcCalls[0]).toEqual(["user_last_contact", { p_user: "target" }]);
  });
  test("maps a permission error to 403 and rejects non-managers without calling the RPC", async () => {
    sessionRpcResult = { data: null, error: { code: "42501", message: "Management not permitted" } };
    expect((await get()).status).toBe(403);
    sessionRpcCalls = [];
    expect((await get({ user: { id: "o" }, profile: { id: "o", role: "OPERATOR", active: true } })).status).toBe(403);
    expect(sessionRpcCalls.length).toBe(0);
  });
});

describe("POST /api/device-status", () => {
  const deviceId = "9c000000-0000-4000-8000-000000000001";
  const post = (body: unknown, auth: unknown = { user: { id: "op" }, profile: { id: "op", role: "OPERATOR", active: true } }) =>
    (deviceStatus as any)({ request: new Request("http://localhost/api/device-status", { method: "POST", body: JSON.stringify(body), headers: { "Content-Type": "application/json" } }), cookies: {}, locals: { auth } }) as Promise<Response>;
  test("reports the device status and answers 204", async () => {
    const response = await post({ deviceId, pendingCount: 3, oldestPendingAt: "2026-10-01T10:00:00Z" });
    expect(response.status).toBe(204);
    expect(sessionRpcCalls[0]).toEqual(["report_device_sync_status", { p_device_id: deviceId, p_pending_count: 3, p_oldest_pending_at: "2026-10-01T10:00:00Z" }]);
  });
  test("rejects invalid payloads and anonymous callers", async () => {
    expect((await post({ deviceId: "no-uuid", pendingCount: 1 })).status).toBe(400);
    expect((await post({ deviceId, pendingCount: -1 })).status).toBe(400);
    expect((await post({ deviceId, pendingCount: 1 }, null)).status).toBe(401);
    expect(sessionRpcCalls.length).toBe(0);
  });
});
