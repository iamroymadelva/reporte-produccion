/// <reference types="bun" />
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { act } from "react";
import type { Root } from "react-dom/client";
import { MACHINE_1, USER_A, USER_B, activate, freshIndexedDb, installBrowser, makeSnapshot } from "./helpers/offline-env";

// Dispositivo compartido (MAJOR-1): tras cerrar sesión, nadie puede operar como el usuario anterior sin conexión,
// y cada usuario solo ve y sube lo suyo. Los datos del usuario anterior se conservan para cuando vuelva a entrar.
const browser = installBrowser();
const { createRoot } = await import("react-dom/client");
const { useLogoutGuard } = await import("../src/components/offline/LogoutGuard");
const outbox = await import("../src/lib/offline/outbox");
const actions = await import("../src/lib/offline/actions");
const sync = await import("../src/lib/offline/sync-client");
const { resolveCurrentUser } = await import("../src/lib/offline/snapshot");
const offlineAuth = await import("../src/lib/offline/offline-auth");
const sessionOf = (userId: string) => ({ userId, role: "OPERATOR" as const, username: userId === USER_A ? "op1" : "op2", fullName: "Operario", startedAt: new Date().toISOString(), offline: true as const });

let root: Root;
let container: HTMLDivElement;
let online: boolean;
let batchCalls: number;
let currentUser: string;
const wait = (ms: number) => act(async () => { await new Promise((resolve) => setTimeout(resolve, ms)); });
const text = () => document.body.textContent ?? "";
const button = (label: string) => [...document.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent?.trim() === label);
const click = async (element: Element | undefined) => { expect(element).toBeDefined(); await act(async () => { (element as HTMLElement).click(); await new Promise((r) => setTimeout(r, 30)); }); };
const ctx = (userId: string, minutes: number) => ({ userId, snapshot: makeSnapshot(userId), now: new Date(Date.now() - (60 - minutes) * 60_000), offline: true });

let submitted = 0;
function Harness({ userId }: { userId: string }) {
  const guard = useLogoutGuard(userId, () => { submitted += 1; });
  return <><button type="button" onClick={guard.request}>Salir</button>{guard.dialog}</>;
}

beforeEach(async () => {
  activate(browser);
  freshIndexedDb();
  sync.resetSyncClientForTests();
  online = true; batchCalls = 0; submitted = 0; currentUser = USER_A;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (!online) throw new TypeError("Failed to fetch");
    if (url === "/api/health") return new Response(null, { status: 204 });
    if (url === "/api/offline/snapshot") return new Response(JSON.stringify(makeSnapshot(currentUser)), { status: 200 });
    if (url === "/api/sync/batch") { batchCalls += 1; return new Response(JSON.stringify({ results: [] }), { status: 200 }); }
    return new Response(null, { status: 204 });
  }) as unknown as typeof fetch;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); sync.resetSyncClientForTests(); });

async function logout(userId: string) {
  await act(async () => { root.render(<Harness userId={userId} />); });
  await click(button("Salir"));
  if (text().includes("Tienes datos sin subir")) await click(button("Cerrar sesión de todos modos"));
  await wait(40);
}

describe("dispositivo compartido", () => {
  test("tras cerrar sesión con pendientes, abrir /turno sin conexión no actúa como el usuario anterior", async () => {
    expect((await resolveCurrentUser()).status).toBe("ok");
    await offlineAuth.startLocalSession(sessionOf(USER_A)); // inicio de sesión sin conexión de A (Phase 8)
    const created = await actions.startReport(ctx(USER_A, 1), MACHINE_1);
    expect(created.ok).toBe(true);

    await logout(USER_A);
    expect(submitted).toBe(1);
    expect(await offlineAuth.getLocalSession()).toBeNull();

    online = false;
    const offline = await resolveCurrentUser({ force: true });
    expect(offline.status).toBe("no-snapshot");
  });

  test("cerrar sesión sin pendientes también olvida al usuario del dispositivo", async () => {
    await resolveCurrentUser();
    await logout(USER_A);
    expect(submitted).toBe(1);
    online = false;
    expect((await resolveCurrentUser({ force: true })).status).toBe("no-snapshot");
  });

  test("el usuario B en el mismo dispositivo ve una cola vacía y no sube nada de A; los datos de A siguen intactos y vuelven al iniciar A", async () => {
    await resolveCurrentUser();
    await actions.startReport(ctx(USER_A, 1), MACHINE_1);
    await logout(USER_A);

    currentUser = USER_B;
    const asB = await resolveCurrentUser({ force: true });
    expect(asB.status === "ok" && asB.userId).toBe(USER_B);
    expect((await sync.getPendingSummary(USER_B)).pending).toBe(0);
    expect(await outbox.listOperations(USER_B)).toEqual([]);
    const outcome = await sync.confirmAndUpload(USER_B);
    expect(outcome.status).toBe("nothing");
    expect(batchCalls).toBe(0);

    // Los datos de A no se perdieron.
    expect(await outbox.listOperations(USER_A)).toHaveLength(1);
    currentUser = USER_A;
    const backAsA = await resolveCurrentUser({ force: true });
    expect(backAsA.status === "ok" && backAsA.userId).toBe(USER_A);
    expect((await sync.getPendingSummary(USER_A)).pending).toBe(1);
    // Sin conexión, A solo vuelve a operar con su contraseña (sesión local); el cierre de sesión no deja a nadie activo.
    online = false;
    expect((await resolveCurrentUser({ force: true })).status).toBe("no-snapshot");
    await offlineAuth.startLocalSession(sessionOf(USER_A));
    const offlineAsA = await resolveCurrentUser({ force: true });
    expect(offlineAsA.status === "ok" && offlineAsA.userId).toBe(USER_A);
  });
});
