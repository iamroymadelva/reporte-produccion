/// <reference types="bun" />
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { CAT_ASEO, CHANGE_PRODUCTO, MACHINE_1, SHIFTS, USER_A, USER_B, activate, freshIndexedDb, installBrowser, makeSnapshot } from "./helpers/offline-env";
import type { OfflineProfile } from "../src/lib/offline/offline-auth";
import { FakeSyncServer } from "./helpers/fake-sync-server";

// T089 (FR-006, FR-006a, FR-006b, FR-006c, SC-012, R8): inicio de sesión sin conexión con verificador PBKDF2,
// ventana de 7 días, bloqueo local 5/15, sesión local limitada al rol, revalidación online antes de subir y marca
// marcador de auditoría OFFLINE_LOGIN. Todo se ejecuta con happy-dom + fake-indexeddb (no es un navegador real).
const browser = installBrowser();
const auth = await import("../src/lib/offline/offline-auth");
const db = await import("../src/lib/offline/db");
const outbox = await import("../src/lib/offline/outbox");
const actions = await import("../src/lib/offline/actions");
const sync = await import("../src/lib/offline/sync-client");
const { resolveCurrentUser, saveSnapshot } = await import("../src/lib/offline/snapshot");

const DAY = 86_400_000;
const PASSWORD = "Clave-Secreta-123";
const OP: OfflineProfile = { userId: USER_A, username: "op1", fullName: "Operario Uno", role: "OPERATOR", offlineLoginWindow: "7 days" };
const COORD: OfflineProfile = { userId: USER_B, username: "coord1", fullName: "Coordinador Uno", role: "ADMINISTRATOR", offlineLoginWindow: "7 days" };
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

let server: FakeSyncServer;
/** Perfil tal como lo devuelve session-info tras un inicio de sesión real ocurrido ahora. */
const signedIn = (profile: OfflineProfile): OfflineProfile => ({ ...profile, signInAt: new Date().toISOString(), serverTime: new Date().toISOString() });
async function enroll(profile: OfflineProfile, password = PASSWORD, now?: Date) {
  await auth.beginEnrollment(profile.username, password, new Date().toISOString());
  return auth.finalizeEnrollment(signedIn(profile), now);
}
/** Simula recargar la página: se cierra la conexión a IndexedDB (los datos persisten en la misma fábrica). */
function reload() { db.closeOfflineDb(); sync.resetSyncClientForTests(); }

beforeEach(async () => {
  activate(browser);
  auth.configureOfflineAuth({ iterations: 1000 }); // las matrículas de las pruebas usan pocas iteraciones (la verificación lee las del registro)
  freshIndexedDb();
  sync.resetSyncClientForTests();
  server = new FakeSyncServer({
    userId: USER_A, shifts: SHIFTS, assignments: SHIFTS.map((shift) => ({ machine_id: MACHINE_1, shift_id: shift.id })),
    categoryIds: [CAT_ASEO], changeTypeIds: [CHANGE_PRODUCTO],
  });
  globalThis.fetch = server.fetch as typeof fetch;
});
afterEach(() => { sync.resetSyncClientForTests(); auth.configureOfflineAuth({}); });

describe("verificador PBKDF2 (FR-006a)", () => {
  test("producción usa 600 000 iteraciones por defecto (prueba lenta, sin configuración)", async () => {
    auth.configureOfflineAuth({}); // valores de producción
    expect(auth.OFFLINE_PBKDF2_ITERATIONS).toBe(600_000);
    expect(auth.getConfiguredIterations()).toBe(600_000);
    expect((await enroll(OP)).status).toBe("enrolled");
    const record = await auth.getCredentialRecord("op1") as any;
    expect(record.iterations).toBe(600_000);
    expect((await auth.verifyOffline("op1", PASSWORD)).status).toBe("ok");
  }, 30_000);

  test("el número de iteraciones es inyectable y cada registro guarda las suyas (la verificación las usa)", async () => {
    auth.configureOfflineAuth({ iterations: 1500 });
    await enroll(OP);
    expect(((await auth.getCredentialRecord("op1")) as any).iterations).toBe(1500);
    auth.configureOfflineAuth({ iterations: 1000 });
    expect((await auth.verifyOffline("op1", PASSWORD)).status).toBe("ok");
  });

  test("se guarda un verificador de 32 B con sal de 16 B; la contraseña no aparece en ninguna parte", async () => {
    expect((await enroll(OP)).status).toBe("enrolled");
    const record = await auth.getCredentialRecord("OP1 ") as any;
    expect(record).not.toBeNull();
    expect(record.iterations).toBe(1000);
    expect(Buffer.from(record.salt, "base64")).toHaveLength(16);
    expect(Buffer.from(record.verifier, "base64")).toHaveLength(32);
    expect(record).toMatchObject({ userId: USER_A, usernameNormalized: "op1", role: "OPERATOR", fullName: "Operario Uno", failedCount: 0, lockedUntil: null });
    // Recorre TODOS los stores: ningún valor guardado contiene la contraseña (ni en claro ni en base64).
    const database = await db.openOfflineDb();
    const everything: string[] = [];
    for (const name of Array.from(database.objectStoreNames)) {
      const rows = await db.withTransaction([name as any], "readonly", (tx) => db.requestResult(tx.objectStore(name).getAll()));
      everything.push(JSON.stringify(rows));
    }
    const dump = everything.join("\n");
    expect(dump).not.toContain(PASSWORD);
    expect(dump).not.toContain(Buffer.from(PASSWORD).toString("base64"));
  });

  test("la matrícula pendiente tampoco contiene la contraseña y la sal distingue dos inscripciones de la misma clave", async () => {
    await auth.beginEnrollment("op1", PASSWORD, new Date().toISOString());
    const pending = await db.getMeta<any>("pendingEnrollment");
    expect(pending).toBeDefined();
    expect(JSON.stringify(pending)).not.toContain(PASSWORD);
    await auth.finalizeEnrollment(signedIn(OP));
    const first = await auth.getCredentialRecord("op1") as any;
    await enroll(OP);
    const second = await auth.getCredentialRecord("op1") as any;
    expect(second.salt).not.toBe(first.salt);
    expect(second.verifier).not.toBe(first.verifier);
  });

  test("medición SC-012: derivar y verificar con 600 000 iteraciones tarda mucho menos de 15 s", async () => {
    auth.configureOfflineAuth({});
    await enroll(OP);
    const started = performance.now();
    const result = await auth.verifyOffline("op1", PASSWORD);
    const elapsed = performance.now() - started;
    console.log(`[SC-012] verifyOffline PBKDF2-SHA-256 600000 it: ${elapsed.toFixed(0)} ms (Bun/happy-dom, escritorio)`);
    expect(result.status).toBe("ok");
    expect(elapsed).toBeLessThan(5_000); // margen 3x frente al límite de 15 s para una tableta ~3x más lenta que el equipo de pruebas
  }, 30_000);
});

describe("habilitación y ventana de 7 días (FR-006)", () => {
  test("con la contraseña correcta dentro de la ventana entra con el rol guardado", async () => {
    const t0 = new Date("2026-10-01T12:00:00Z");
    await enroll(OP, PASSWORD, t0);
    const result = await auth.verifyOffline("op1", PASSWORD, new Date(t0.getTime() + 6 * DAY));
    expect(result.status).toBe("ok");
    if (result.status === "ok") expect(result.session).toMatchObject({ userId: USER_A, role: "OPERATOR", username: "op1", fullName: "Operario Uno", offline: true });
  });

  test("con la ventana vencida, aun con la contraseña correcta, pide conexión", async () => {
    const t0 = new Date("2026-10-01T12:00:00Z");
    await enroll(OP, PASSWORD, t0);
    expect((await auth.verifyOffline("op1", PASSWORD, new Date(t0.getTime() + 8 * DAY))).status).toBe("needs-connection");
    expect(auth.NEEDS_CONNECTION_MESSAGE).toBe("Necesitas conexión para entrar");
  });

  test("la ventana sale de los ajustes del servidor (p. ej. 1 day)", async () => {
    const t0 = new Date("2026-10-01T12:00:00Z");
    await enroll({ ...OP, offlineLoginWindow: "1 day" }, PASSWORD, t0);
    expect((await auth.verifyOffline("op1", PASSWORD, new Date(t0.getTime() + 2 * DAY))).status).toBe("needs-connection");
  });

  test("un usuario que nunca inició sesión en línea en el dispositivo necesita conexión", async () => {
    await enroll(OP);
    expect((await auth.verifyOffline("op2", PASSWORD)).status).toBe("needs-connection");
  });

  test("si el login en línea falló (matrícula pendiente descartada) no queda nada habilitado", async () => {
    await auth.beginEnrollment("op1", PASSWORD, new Date().toISOString());
    await auth.discardPendingEnrollment();
    expect((await auth.finalizeEnrollment(signedIn(OP))).status).toBe("no-pending");
    expect((await auth.verifyOffline("op1", PASSWORD)).status).toBe("needs-connection");
  });

  test("una matrícula pendiente sin confirmar por el servidor tampoco habilita el acceso", async () => {
    await auth.beginEnrollment("op1", PASSWORD, new Date().toISOString());
    expect((await auth.verifyOffline("op1", PASSWORD)).status).toBe("needs-connection");
  });

  test("la matrícula pendiente de otro usuario no se confirma con el perfil recibido", async () => {
    await auth.beginEnrollment("op2", PASSWORD, new Date().toISOString());
    expect((await auth.finalizeEnrollment(signedIn(OP))).status).toBe("mismatch");
    expect((await auth.verifyOffline("op1", PASSWORD)).status).toBe("needs-connection");
    expect((await auth.verifyOffline("op2", PASSWORD)).status).toBe("needs-connection");
  });

  test("una matrícula pendiente caduca a los 10 minutos", async () => {
    await auth.beginEnrollment("op1", PASSWORD, new Date().toISOString());
    expect((await auth.finalizeEnrollment({ ...signedIn(OP), serverTime: new Date(Date.now() + 11 * 60_000).toISOString() })).status).toBe("no-pending");
  });

  test("MAJOR-2: una sesión previa (signInAt anterior al inicio de la matrícula) NO confirma la matrícula y la descarta", async () => {
    const before = new Date(Date.now() - 10 * 60_000).toISOString();
    await auth.beginEnrollment("op1", PASSWORD, new Date().toISOString());
    expect((await auth.finalizeEnrollment({ ...OP, signInAt: before, serverTime: new Date().toISOString() })).status).toBe("stale-session");
    expect(await auth.hasPendingEnrollment()).toBe(false);
    expect((await auth.verifyOffline("op1", PASSWORD)).status).toBe("needs-connection");
    await auth.beginEnrollment("op1", PASSWORD, new Date().toISOString());
    expect((await auth.finalizeEnrollment({ ...OP, signInAt: null, serverTime: new Date().toISOString() })).status).toBe("stale-session"); // sin hora de inicio de sesión
  });

  // Ronda 3: la matrícula se ata a horas del SERVIDOR; el reloj del dispositivo no interviene.
  const DAY_MS = 86_400_000;
  const withDeviceClock = async <T,>(offsetMs: number, work: () => Promise<T>) => {
    const RealDate = Date;
    const skewed = class extends RealDate {
      constructor(...args: any[]) { if (args.length === 0) super(RealDate.now() + offsetMs); else super(...(args as [any])); }
      static now() { return RealDate.now() + offsetMs; }
    };
    (globalThis as { Date: DateConstructor }).Date = skewed as unknown as DateConstructor;
    try { return await work(); } finally { (globalThis as { Date: DateConstructor }).Date = RealDate; }
  };

  test("RONDA 3 (1): dispositivo atrasado un día + sesión previa (signInAt anterior a la hora del servidor al iniciar) → descartada", async () => {
    const serverNow = new Date("2026-10-10T15:00:00Z");
    await withDeviceClock(-DAY_MS, async () => {
      await auth.beginEnrollment("op1", PASSWORD, serverNow.toISOString()); // el reloj local marca el día anterior
    });
    const previousSession = new Date(serverNow.getTime() - 3_600_000).toISOString(); // sesión de A abierta hace 1 h
    const result = await withDeviceClock(-DAY_MS, () => auth.finalizeEnrollment({ ...OP, signInAt: previousSession, serverTime: new Date(serverNow.getTime() + 5_000).toISOString() }));
    expect(result.status).toBe("stale-session");
    expect(await auth.hasPendingEnrollment()).toBe(false);
    expect(await auth.getCredentialRecord("op1")).toBeNull();
    expect((await auth.verifyOffline("op1", PASSWORD)).status).toBe("needs-connection");
  });

  test("RONDA 3 (2): dispositivo adelantado 5 min + login nuevo → matriculada y el acceso sin conexión funciona", async () => {
    const serverNow = new Date();
    await withDeviceClock(5 * 60_000, async () => {
      await auth.beginEnrollment("op1", PASSWORD, serverNow.toISOString());
    });
    const result = await withDeviceClock(5 * 60_000, () => auth.finalizeEnrollment({
      ...OP, signInAt: new Date(serverNow.getTime() + 1_000).toISOString(), serverTime: new Date(serverNow.getTime() + 2_000).toISOString(),
    }));
    expect(result.status).toBe("enrolled");
    expect((await auth.verifyOffline("op1", PASSWORD, new Date(Date.now() + 5 * 60_000 + 1000))).status).toBe("ok");
  });

  test("RONDA 3 (3): sin hora del servidor no se matricula (ni al iniciar ni al confirmar) y no queda nada pendiente", async () => {
    expect(await auth.beginEnrollment("op1", PASSWORD, null)).toBe(false);
    expect(await auth.beginEnrollment("op1", PASSWORD, undefined)).toBe(false);
    expect(await auth.beginEnrollment("op1", PASSWORD, "no es una fecha")).toBe(false);
    expect(await auth.hasPendingEnrollment()).toBe(false);
    expect((await auth.finalizeEnrollment(signedIn(OP))).status).toBe("no-pending");
    expect(await auth.getCredentialRecord("op1")).toBeNull();
    // pendiente válida pero session-info sin serverTime / signInAt: se descarta
    await auth.beginEnrollment("op1", PASSWORD, new Date().toISOString());
    expect((await auth.finalizeEnrollment({ ...OP, signInAt: new Date().toISOString(), serverTime: null })).status).toBe("stale-session");
    expect(await auth.hasPendingEnrollment()).toBe(false);
  });

  test("RONDA 3: el vencimiento de 10 min se mide con la hora del servidor, no con el reloj del dispositivo", async () => {
    const serverNow = new Date("2026-10-10T15:00:00Z");
    await auth.beginEnrollment("op1", PASSWORD, serverNow.toISOString());
    // el reloj local avanza mucho (atacante o error), pero el servidor dice que pasaron 2 min: vale
    const ok = await withDeviceClock(3 * DAY_MS, () => auth.finalizeEnrollment({ ...OP, signInAt: new Date(serverNow.getTime() + 1000).toISOString(), serverTime: new Date(serverNow.getTime() + 120_000).toISOString() }));
    expect(ok.status).toBe("enrolled");
    await auth.beginEnrollment("op1", PASSWORD, serverNow.toISOString());
    const late = await auth.finalizeEnrollment({ ...OP, signInAt: new Date(serverNow.getTime() + 1000).toISOString(), serverTime: new Date(serverNow.getTime() + 11 * 60_000).toISOString() });
    expect(late.status).toBe("no-pending");
  });

  test("MAJOR-2: un inicio de sesión nuevo (posterior al inicio, con 30 s de tolerancia de reloj) sí matricula", async () => {
    await auth.beginEnrollment("op1", PASSWORD, new Date().toISOString());
    expect((await auth.finalizeEnrollment({ ...OP, signInAt: new Date(Date.now() + 2_000).toISOString(), serverTime: new Date().toISOString() })).status).toBe("enrolled");
    await auth.beginEnrollment("op1", PASSWORD, new Date().toISOString());
    expect((await auth.finalizeEnrollment({ ...OP, signInAt: new Date(Date.now() - 20_000).toISOString(), serverTime: new Date().toISOString() })).status).toBe("enrolled"); // dentro de la tolerancia
    await auth.beginEnrollment("op1", PASSWORD, new Date().toISOString());
    expect((await auth.finalizeEnrollment({ ...OP, signInAt: new Date(Date.now() - 60_000).toISOString(), serverTime: new Date().toISOString() })).status).toBe("stale-session");
  });

  test("un nuevo login en línea con otra contraseña reemplaza al verificador anterior", async () => {
    await enroll(OP, PASSWORD);
    await enroll(OP, "Otra-Clave-456");
    expect((await auth.verifyOffline("op1", PASSWORD)).status).toBe("invalid");
    expect((await auth.verifyOffline("op1", "Otra-Clave-456")).status).toBe("ok");
  });

  test("cada login en línea renueva enabledUntil", async () => {
    const t0 = new Date("2026-10-01T12:00:00Z");
    await enroll(OP, PASSWORD, t0);
    const t1 = new Date(t0.getTime() + 5 * DAY);
    await enroll(OP, PASSWORD, t1);
    expect((await auth.verifyOffline("op1", PASSWORD, new Date(t1.getTime() + 6 * DAY))).status).toBe("ok");
  });
});

describe("bloqueo local 5 / 15 min (FR-006a, FR-004)", () => {
  test("contraseña errónea: mensaje genérico; 5 fallos bloquean 15 min, también a la contraseña correcta, y el bloqueo sobrevive a recargar", async () => {
    const t0 = new Date("2026-10-01T12:00:00Z");
    await enroll(OP, PASSWORD, t0);
    for (let attempt = 1; attempt <= 4; attempt += 1) {
      expect((await auth.verifyOffline("op1", "mal", new Date(t0.getTime() + attempt * 1000))).status).toBe("invalid");
    }
    const fifth = await auth.verifyOffline("op1", "mal", new Date(t0.getTime() + 5000));
    expect(fifth.status === "locked" || fifth.status === "invalid").toBe(true);
    expect((await auth.getCredentialRecord("op1") as any).lockedUntil).not.toBeNull();

    reload();
    const during = await auth.verifyOffline("op1", PASSWORD, new Date(t0.getTime() + 10 * 60_000));
    expect(during.status).toBe("locked");
    expect(auth.INVALID_CREDENTIALS_MESSAGE).toBe("Usuario o contraseña incorrectos");

    const after = await auth.verifyOffline("op1", PASSWORD, new Date(t0.getTime() + 5000 + 15 * 60_000 + 1000));
    expect(after.status).toBe("ok");
    expect((await auth.getCredentialRecord("op1") as any).failedCount).toBe(0);
  });

  test("un acierto antes del quinto fallo reinicia el contador", async () => {
    await enroll(OP);
    for (let i = 0; i < 3; i += 1) await auth.verifyOffline("op1", "mal");
    expect((await auth.verifyOffline("op1", PASSWORD)).status).toBe("ok");
    for (let i = 0; i < 4; i += 1) expect((await auth.verifyOffline("op1", "mal")).status).toBe("invalid");
    expect((await auth.verifyOffline("op1", PASSWORD)).status).toBe("ok");
  });

  test("la contraseña de otro usuario del mismo dispositivo no abre la sesión de op1", async () => {
    await enroll(OP, PASSWORD);
    await enroll(COORD, "Clave-Coord-999");
    expect((await auth.verifyOffline("op1", "Clave-Coord-999")).status).toBe("invalid");
    expect((await auth.verifyOffline("coord1", PASSWORD)).status).toBe("invalid");
  });
});

describe("sesión local limitada al rol guardado (FR-006c)", () => {
  test("el inicio de sesión offline crea la sesión local, deja un marcador de auditoría (sin operación en la outbox) y navega por rol", async () => {
    expect(auth.landingPathFor("OPERATOR")).toBe("/turno");
    for (const role of ["ROOT", "ADMINISTRATOR", "VIEWER"] as const) expect(auth.landingPathFor(role)).toBe("/consulta-offline");
    await enroll(OP);
    const result = await auth.loginOffline("op1", PASSWORD);
    expect(result.status).toBe("ok");
    expect(await auth.getLocalSession()).toMatchObject({ userId: USER_A, role: "OPERATOR", username: "op1", offline: true });
    expect(await outbox.listOperations(USER_A)).toEqual([]);
    const markers = await auth.listOfflineLoginMarkers();
    expect(markers).toHaveLength(1);
    expect(markers[0]).toMatchObject({ userId: USER_A });
    expect(Number.isNaN(Date.parse(markers[0].startedAt))).toBe(false);
    expect(markers[0].operationId).toMatch(/^[0-9a-f-]{36}$/);
  });

  test("MINOR-5: la sesión local termina a las 12 h o al vencer enabledUntil (lo que ocurra antes)", async () => {
    const t0 = new Date("2026-10-01T12:00:00Z");
    await enroll(OP, PASSWORD, t0); // enabledUntil = t0 + 7 días
    expect((await auth.loginOffline("op1", PASSWORD, t0)).status).toBe("ok");
    expect(await auth.getLocalSession(new Date(t0.getTime() + 11 * 3_600_000))).not.toBeNull();
    expect(await auth.getLocalSession(new Date(t0.getTime() + 12 * 3_600_000 + 1000))).toBeNull(); // 12 h
    expect(await auth.getLocalSession(new Date(t0.getTime() + 1000))).toBeNull(); // y se eliminó
    // enabledUntil antes de las 12 h
    const t1 = new Date("2026-10-02T12:00:00Z");
    await enroll({ ...OP, offlineLoginWindow: "2:00:00" }, PASSWORD, t1); // ventana de 2 h
    await auth.loginOffline("op1", PASSWORD, new Date(t1.getTime() + 60_000));
    expect(await auth.getLocalSession(new Date(t1.getTime() + 90 * 60_000))).not.toBeNull();
    expect(await auth.getLocalSession(new Date(t1.getTime() + 125 * 60_000))).toBeNull();
  });

  test("MINOR-5: los shells comprueban la caducidad (resolveCurrentUser sin conexión no opera con una sesión vencida)", async () => {
    await saveSnapshot(makeSnapshot(USER_A));
    await auth.startLocalSession({ userId: USER_A, role: "OPERATOR", username: "op1", fullName: "Operario Uno", startedAt: new Date(Date.now() - 13 * 3_600_000).toISOString(), offline: true });
    server.mode.networkDown = true;
    expect((await resolveCurrentUser({ force: true })).status).toBe("no-snapshot");
  });

  test("un intento fallido no crea sesión ni operación", async () => {
    await enroll(OP);
    expect((await auth.loginOffline("op1", "mal")).status).toBe("invalid");
    expect(await auth.getLocalSession()).toBeNull();
    expect(await outbox.listOperations(USER_A)).toEqual([]);
  });

  test("sin conexión resolveCurrentUser usa la sesión local (no el último usuario) y cerrar sesión la elimina", async () => {
    await saveSnapshot(makeSnapshot(USER_A));
    await enroll(OP);
    // Sin sesión local, aunque exista snapshot, nadie opera sin la contraseña.
    server.mode.networkDown = true;
    expect((await resolveCurrentUser({ force: true })).status).toBe("no-snapshot");

    await auth.loginOffline("op1", PASSWORD);
    const current = await resolveCurrentUser({ force: true });
    expect(current.status === "ok" && current.userId).toBe(USER_A);
    expect(current.status === "ok" && current.online).toBe(false);

    await auth.clearLocalSession();
    expect((await resolveCurrentUser({ force: true })).status).toBe("no-snapshot");
  });

  test("una sesión local de rol no operario no abre el turno del operario", async () => {
    await saveSnapshot(makeSnapshot(USER_B));
    await enroll(COORD, "Clave-Coord-999");
    await auth.loginOffline("coord1", "Clave-Coord-999");
    server.mode.networkDown = true;
    const current = await resolveCurrentUser({ force: true });
    expect(current.status).toBe("forbidden");
  });

  test("dispositivo compartido: B entra sin conexión con SU contraseña y no ve ni sube lo de A", async () => {
    await saveSnapshot(makeSnapshot(USER_A));
    await saveSnapshot(makeSnapshot(USER_B, { profile: { id: USER_B, full_name: "Operario Dos", role: "OPERATOR", job_title: null } }));
    await enroll(OP, PASSWORD);
    await enroll({ ...OP, userId: USER_B, username: "op2", fullName: "Operario Dos" }, "Clave-Dos-777");
    server.mode.networkDown = true;

    await auth.loginOffline("op1", PASSWORD);
    const created = await actions.startReport({ userId: USER_A, snapshot: makeSnapshot(USER_A), now: new Date(Date.now() - 60_000), offline: true }, MACHINE_1);
    expect(created.ok).toBe(true);
    await auth.clearLocalSession(); // cierre de sesión de A

    expect((await auth.verifyOffline("op2", PASSWORD)).status).toBe("invalid"); // B no puede usar la contraseña de A
    await auth.loginOffline("op2", "Clave-Dos-777");
    const asB = await resolveCurrentUser({ force: true });
    expect(asB.status === "ok" && asB.userId).toBe(USER_B);
    expect(await outbox.listOperations(USER_B)).toEqual([]);
    expect((await outbox.listOperations(USER_A)).map((operation) => operation.type)).toEqual(["CREATE_REPORT"]);
    expect((await auth.listOfflineLoginMarkers()).map((marker) => marker.userId)).toEqual([USER_A, USER_B]);
  });
});

describe("revalidación al reconectar (FR-006b)", () => {
  async function offlineSessionWithWork() {
    await saveSnapshot(makeSnapshot(USER_A));
    await enroll(OP);
    server.mode.networkDown = true;
    await auth.loginOffline("op1", PASSWORD);
    const created = await actions.startReport({ userId: USER_A, snapshot: makeSnapshot(USER_A), now: new Date(Date.now() - 60_000), offline: true }, MACHINE_1);
    if (!created.ok) throw new Error(created.message);
    server.mode.networkDown = false;
    server.calls.length = 0;
  }
  async function reconnect() {
    browser.dispatchEvent(new browser.Event("offline")); await wait(5);
    browser.dispatchEvent(new browser.Event("online")); await wait(80);
  }

  test("al reconectar sin login en línea no se ofrece la subida y confirmAndUpload no llama a la red", async () => {
    await offlineSessionWithWork();
    const stop = sync.startSyncMonitor(USER_A);
    await reconnect();
    expect(sync.getSyncState(USER_A).loginRequired).toBe(true);
    const outcome = await sync.confirmAndUpload(USER_A);
    expect(outcome.status).toBe("login-required");
    expect(server.calls.filter((call) => call.url === "/api/sync/batch")).toHaveLength(0);
    expect((await outbox.listOperations(USER_A)).every((operation) => operation.state === "pending")).toBe(true);
    stop();
  });

  test("tras el login en línea (matrícula confirmada) la sesión local se retira y el lote sube sin operaciones de auditoría", async () => {
    await offlineSessionWithWork();
    await auth.beginEnrollment("op1", PASSWORD, new Date().toISOString()); // el formulario de login en línea
    expect((await auth.finalizeEnrollment(signedIn(OP))).status).toBe("enrolled");
    expect(await auth.getLocalSession()).toBeNull();

    const outcome = await sync.confirmAndUpload(USER_A);
    expect(outcome.status).toBe("complete");
    expect(server.batches).toHaveLength(1);
    const sent = server.calls.find((call) => call.url === "/api/sync/batch")!.body.operations as Array<{ type: string }>;
    expect(sent.map((operation) => operation.type)).toEqual(["CREATE_REPORT"]); // un solo camino de auditoría: el marcador
  });

  test("MAJOR-3: el bootstrap envía el marcador del MISMO usuario a /api/offline/login-audit y lo borra (un solo registro)", async () => {
    await offlineSessionWithWork();
    const [marker] = await auth.listOfflineLoginMarkers();
    const { runOfflineBootstrap } = await import("../src/lib/offline/bootstrap");
    await runOfflineBootstrap({ pathname: "/dashboard", search: "" });
    expect(server.loginAudits).toHaveLength(1);
    expect(server.loginAudits[0]).toMatchObject({ operationId: marker.operationId, startedAt: marker.startedAt });
    expect(await auth.listOfflineLoginMarkers()).toEqual([]);
    await runOfflineBootstrap({ pathname: "/reportes", search: "" });
    expect(server.loginAudits).toHaveLength(1); // no se vuelve a enviar
  });

  test("MAJOR-3: el marcador de otro usuario no se envía con la sesión de este y se conserva; sin red tampoco se pierde", async () => {
    await auth.addOfflineLoginMarker(USER_B, new Date().toISOString()); // login sin conexión de B
    const { runOfflineBootstrap } = await import("../src/lib/offline/bootstrap");
    await runOfflineBootstrap({ pathname: "/dashboard", search: "" }); // la sesión en línea es A (fake server)
    expect(server.loginAudits).toHaveLength(0);
    expect(await auth.listOfflineLoginMarkers()).toHaveLength(1);
    server.sessionInfo = { userId: USER_B, username: "coord1", fullName: "Coordinador Uno", role: "ADMINISTRATOR", active: true, offlineLoginWindow: "7 days", signInAt: new Date().toISOString() };
    server.mode.networkDown = true;
    await runOfflineBootstrap({ pathname: "/dashboard", search: "" });
    expect(await auth.listOfflineLoginMarkers()).toHaveLength(1);
    server.mode.networkDown = false;
    await runOfflineBootstrap({ pathname: "/dashboard", search: "" }); // ahora la sesión en línea es B (cualquier rol)
    expect(server.loginAudits).toHaveLength(1);
    expect(await auth.listOfflineLoginMarkers()).toEqual([]);
  });

  test("usuario desactivado: sesión local cerrada, cierre de sesión en el servidor, pendientes conservados y nada se sube", async () => {
    await offlineSessionWithWork();
    server.mode.forbidden = true;
    const stop = sync.startSyncMonitor(USER_A);
    await reconnect();
    const state = sync.getSyncState(USER_A);
    expect(state.inactive).toBe(true);
    expect(state.message ?? "").toContain("datos");
    expect(await auth.getLocalSession()).toBeNull();
    expect(server.signedOut).toBe(true);
    expect((await outbox.listOperations(USER_A)).filter((operation) => operation.state === "pending").length).toBeGreaterThanOrEqual(1);
    expect(server.calls.filter((call) => call.url === "/api/sync/batch")).toHaveLength(0);
    stop();
  });

  test("rol cambiado en el servidor: sesión local cerrada y pendientes conservados", async () => {
    await offlineSessionWithWork();
    server.sessionInfo = { userId: USER_A, username: "op1", fullName: "Operario Uno", role: "ADMINISTRATOR", active: true, offlineLoginWindow: "7 days" };
    const stop = sync.startSyncMonitor(USER_A);
    await reconnect();
    expect(sync.getSyncState(USER_A).inactive).toBe(true);
    expect(await auth.getLocalSession()).toBeNull();
    expect((await outbox.listOperations(USER_A)).length).toBeGreaterThanOrEqual(1);
    stop();
  });

  test("una sesión del servidor de OTRO usuario no sirve para subir lo de la sesión local", async () => {
    await offlineSessionWithWork();
    server.sessionInfo = { userId: USER_B, username: "op2", fullName: "Operario Dos", role: "OPERATOR", active: true, offlineLoginWindow: "7 days" };
    const stop = sync.startSyncMonitor(USER_A);
    await reconnect();
    expect(sync.getSyncState(USER_A).loginRequired).toBe(true);
    expect((await sync.confirmAndUpload(USER_A)).status).toBe("login-required");
    stop();
  });
});

describe("arranque del acceso sin conexión (bootstrap)", () => {
  const boot = async (context: Partial<{ pathname: string; search: string; userId: string; role: string }> = {}) => {
    const { runOfflineBootstrap } = await import("../src/lib/offline/bootstrap");
    await runOfflineBootstrap({ pathname: "/dashboard", search: "", ...context });
  };

  test("la primera página autenticada confirma la matrícula con la identidad del servidor y retira la sesión local", async () => {
    await auth.startLocalSession({ userId: USER_A, role: "OPERATOR", username: "op1", fullName: "Operario Uno", startedAt: new Date().toISOString(), offline: true });
    await auth.beginEnrollment("op1", PASSWORD, new Date().toISOString());
    await boot();
    expect((await auth.getCredentialRecord("op1"))?.userId).toBe(USER_A);
    expect(await db.getMeta("pendingEnrollment")).toBeUndefined();
    expect(await auth.getLocalSession()).toBeNull();
    expect((await auth.verifyOffline("op1", PASSWORD)).status).toBe("ok");
  });

  test("si el servidor responde 401 a la identidad, la matrícula pendiente se descarta", async () => {
    server.mode.unauthorized = true;
    await auth.beginEnrollment("op1", PASSWORD, new Date().toISOString());
    await boot();
    expect(await auth.hasPendingEnrollment()).toBe(false);
    expect(await auth.getCredentialRecord("op1")).toBeNull();
  });

  test("volver a /iniciar-sesion con ?error= (login fallido) descarta la matrícula pendiente", async () => {
    await auth.beginEnrollment("op1", PASSWORD, new Date().toISOString());
    await boot({ pathname: "/iniciar-sesion", search: "?error=Usuario%20o%20contrase%C3%B1a%20incorrectos" });
    expect(await auth.hasPendingEnrollment()).toBe(false);
    expect(await auth.getCredentialRecord("op1")).toBeNull();
  });

  test("sin red la matrícula pendiente se conserva para la siguiente página", async () => {
    server.mode.networkDown = true;
    await auth.beginEnrollment("op1", PASSWORD, new Date().toISOString());
    await boot();
    expect(await auth.hasPendingEnrollment()).toBe(true);
  });

  test("el cierre de sesión hecho sin conexión se completa en el servidor en la primera página con red", async () => {
    await auth.markServerLogoutPending();
    await boot({ pathname: "/iniciar-sesion" });
    expect(server.signedOut).toBe(true);
    expect(await auth.isServerLogoutPending()).toBe(false);
  });

  test("la cookie en línea de OTRA persona no se usa para operar como la sesión local: se cierra y se pide iniciar sesión", async () => {
    await saveSnapshot(makeSnapshot(USER_A));
    await enroll(OP);
    server.mode.networkDown = true;
    await auth.loginOffline("op1", PASSWORD);
    server.mode.networkDown = false;
    server.snapshot = { ...makeSnapshot(USER_B), profile: { id: USER_B, full_name: "Operario Dos", role: "OPERATOR", job_title: null } };
    const current = await resolveCurrentUser({ force: true });
    expect(current.status).toBe("unauthorized");
    expect(server.signedOut).toBe(true);
    expect((await auth.getLocalSession())?.userId).toBe(USER_A); // la sesión local y sus datos siguen intactos
  });

  test("el resumen de la consulta se refresca en silencio solo para manager/VIEWER y como mucho cada 5 minutos", async () => {
    const overview = await import("../src/lib/offline/overview");
    overview.resetOverviewRefreshForTests();
    let hits = 0;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      if (String(input) === "/api/offline/overview") {
        hits += 1;
        return new Response(JSON.stringify({ kpis: { date: "2026-10-10", DRAFT: 0, SUBMITTED: 0, CLOSED: 0, CANCELLED: 0, ACTIVE_STOP: 0, OFF_SHIFT: 0 }, reports: [], fetchedAt: "2026-10-10T15:00:00Z", serverTime: "2026-10-10T15:00:00Z" }), { status: 200 });
      }
      return new Response(null, { status: 204 });
    }) as typeof fetch;
    await overview.refreshOverviewSilently(USER_A, "OPERATOR");
    expect(hits).toBe(0);
    await overview.refreshOverviewSilently(USER_B, "ADMINISTRATOR", 1_000_000);
    await overview.refreshOverviewSilently(USER_B, "ADMINISTRATOR", 1_060_000);
    expect(hits).toBe(1);
    expect((await overview.loadOverview(USER_B))?.fetchedAt).toBe("2026-10-10T15:00:00Z");
    await overview.refreshOverviewSilently(USER_B, "VIEWER", 1_000_000 + 6 * 60_000);
    expect(hits).toBe(2);
  });
});
