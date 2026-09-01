export type ConnectivityState = "online" | "checking" | "offline" | "unreachable";

export interface ConnectivitySnapshot {
  state: ConnectivityState;
  restored: boolean;
}

export const MUTATION_REQUIRES_CONNECTION = "Esta acción requiere conexión. Verifica tu conexión e inténtalo de nuevo.";
export const MUTATION_RESULT_UNCERTAIN = "No fue posible confirmar el resultado. Recupera la conexión y actualiza antes de intentarlo de nuevo.";

const CONNECTIVITY_EVENT = "app:connectivity-change";
const NOTICE_EVENT = "app:connectivity-notice";
const HEALTH_URL = "/api/health";
const HEALTH_TIMEOUT_MS = 4_000;
const FRESH_CHECK_MS = 60_000;
const RETRY_DELAYS_MS = [10_000, 30_000, 60_000];

let initialized = false;
let state: ConnectivityState = "online";
let lastSuccessfulCheck = 0;
let checkPromise: Promise<boolean> | null = null;
let retryTimer: number | null = null;
let retryAttempt = 0;
let experiencedConnectionLoss = false;

function inBrowser() {
  return typeof window !== "undefined" && typeof navigator !== "undefined";
}

function emit(restored = false) {
  if (!inBrowser()) return;
  window.dispatchEvent(new CustomEvent<ConnectivitySnapshot>(CONNECTIVITY_EVENT, {
    detail: { state, restored },
  }));
}

function setState(next: ConnectivityState) {
  if (state === next) return;
  const previous = state;
  state = next;
  const restored = next === "online" && experiencedConnectionLoss && (previous === "offline" || previous === "unreachable" || previous === "checking");
  if (next === "offline" || next === "unreachable") experiencedConnectionLoss = true;
  emit(restored);
}

function clearRetry() {
  if (!inBrowser() || retryTimer === null) return;
  window.clearTimeout(retryTimer);
  retryTimer = null;
}

function scheduleRetry() {
  if (!inBrowser() || document.visibilityState !== "visible" || state !== "unreachable" || retryTimer !== null) return;
  const delay = RETRY_DELAYS_MS[Math.min(retryAttempt, RETRY_DELAYS_MS.length - 1)];
  retryAttempt += 1;
  retryTimer = window.setTimeout(() => {
    retryTimer = null;
    void checkApplicationReachability({ force: true });
  }, delay);
}

function markOnline() {
  clearRetry();
  retryAttempt = 0;
  lastSuccessfulCheck = Date.now();
  setState("online");
}

export function markConnectionFailure() {
  if (!inBrowser()) return;
  if (!navigator.onLine) {
    clearRetry();
    setState("offline");
    return;
  }
  setState("unreachable");
  scheduleRetry();
}

export function initializeConnectivity() {
  if (!inBrowser() || initialized) return;
  initialized = true;
  lastSuccessfulCheck = Date.now();

  if (!navigator.onLine) {
    experiencedConnectionLoss = true;
    state = "offline";
  }

  window.addEventListener("offline", () => {
    clearRetry();
    setState("offline");
  });

  window.addEventListener("online", () => {
    retryAttempt = 0;
    void checkApplicationReachability({ force: true });
  });

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible") {
      clearRetry();
      return;
    }
    if (state === "unreachable") {
      void checkApplicationReachability({ force: true });
      return;
    }
    if (Date.now() - lastSuccessfulCheck >= FRESH_CHECK_MS) void checkApplicationReachability();
  });

  window.addEventListener("pageshow", (event) => {
    if (event.persisted || Date.now() - lastSuccessfulCheck >= FRESH_CHECK_MS) void checkApplicationReachability();
  });

  emit();
}

export function getConnectivitySnapshot(): ConnectivitySnapshot {
  if (!inBrowser()) return { state: "online", restored: false };
  initializeConnectivity();
  return { state, restored: false };
}

export function subscribeConnectivity(listener: (snapshot: ConnectivitySnapshot) => void) {
  if (!inBrowser()) return () => undefined;
  initializeConnectivity();
  const handler = (event: Event) => listener((event as CustomEvent<ConnectivitySnapshot>).detail);
  window.addEventListener(CONNECTIVITY_EVENT, handler);
  listener(getConnectivitySnapshot());
  return () => window.removeEventListener(CONNECTIVITY_EVENT, handler);
}

export async function checkApplicationReachability(options: { force?: boolean } = {}) {
  if (!inBrowser()) return true;
  initializeConnectivity();

  if (!navigator.onLine) {
    markConnectionFailure();
    return false;
  }
  if (!options.force && state === "online" && Date.now() - lastSuccessfulCheck < FRESH_CHECK_MS) return true;
  if (checkPromise) return checkPromise;

  setState("checking");
  checkPromise = (async () => {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), HEALTH_TIMEOUT_MS);
    try {
      const response = await fetch(HEALTH_URL, {
        method: "HEAD",
        cache: "no-store",
        credentials: "same-origin",
        signal: controller.signal,
      });
      if (response.status !== 204) throw new Error("La comprobación de conexión no respondió correctamente.");
      markOnline();
      return true;
    } catch {
      markConnectionFailure();
      return false;
    } finally {
      window.clearTimeout(timeout);
      checkPromise = null;
    }
  })();

  return checkPromise;
}

export async function canSendMutation() {
  if (!inBrowser()) return true;
  initializeConnectivity();
  if (!navigator.onLine) {
    markConnectionFailure();
    return false;
  }
  if (state === "offline" || state === "unreachable") return false;
  if (state === "checking" && checkPromise) return checkPromise;
  return checkApplicationReachability();
}

export class MutationConnectivityError extends Error {
  readonly kind: "blocked" | "uncertain";

  constructor(kind: "blocked" | "uncertain") {
    super(kind === "blocked" ? MUTATION_REQUIRES_CONNECTION : MUTATION_RESULT_UNCERTAIN);
    this.name = "MutationConnectivityError";
    this.kind = kind;
  }
}

export async function guardedMutationFetch(input: RequestInfo | URL, init: RequestInit) {
  if (!(await canSendMutation())) {
    showConnectivityNotice(MUTATION_REQUIRES_CONNECTION);
    throw new MutationConnectivityError("blocked");
  }

  try {
    const response = await fetch(input, init);
    markOnline();
    return response;
  } catch {
    markConnectionFailure();
    showConnectivityNotice(MUTATION_RESULT_UNCERTAIN);
    throw new MutationConnectivityError("uncertain");
  }
}

export function showConnectivityNotice(message: string) {
  if (!inBrowser()) return;
  window.dispatchEvent(new CustomEvent<string>(NOTICE_EVENT, { detail: message }));
}

export function subscribeConnectivityNotices(listener: (message: string) => void) {
  if (!inBrowser()) return () => undefined;
  const handler = (event: Event) => listener((event as CustomEvent<string>).detail);
  window.addEventListener(NOTICE_EVENT, handler);
  return () => window.removeEventListener(NOTICE_EVENT, handler);
}
