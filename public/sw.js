const CACHE_PREFIX = "reporte-produccion-static";
const CACHE_VERSION = "v5";
const CACHE_NAME = `${CACHE_PREFIX}-${CACHE_VERSION}`;
const PRECACHE_URLS = [
  "/offline.html",
  "/manifest.webmanifest",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/apple-touch-icon-180.png",
];
// Shells estáticos (HTML prerenderizado SIN datos): /turno (Operario, T085), /consulta-offline (managers y auditores,
// T094) y /acceso-offline (inicio de sesión sin conexión, T092). Son el ÚNICO HTML que se guarda en Cache Storage; el
// HTML SSR autenticado y /api/** nunca se guardan (Principio III, docs/PWA_OFFLINE.md).
const SHELL_URL = "/turno";
const SHELL_URLS = ["/turno", "/consulta-offline", "/acceso-offline"];
const ICON_URLS = new Set([
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/apple-touch-icon-180.png",
]);

/** Un HTML guardable es la respuesta directa (200, sin redirección) del shell: una redirección a login no se guarda. */
function isCacheableShell(response) {
  return response.ok && !response.redirected && response.type === "basic";
}

/**
 * Descarga los shells y TODOS los recursos /_astro/ que necesitan (los referenciados por el HTML y las importaciones
 * relativas entre chunks). Si algo no se puede cachear LANZA: la instalación falla y siguen el worker y la caché
 * anteriores (MAJOR-3). Solo un 404 de un chunk deducido por patrón se ignora (puede ser una cadena que no es chunk).
 */
async function precacheShells(cache) {
  const queue = [];
  for (const shellUrl of SHELL_URLS) {
    const response = await fetch(shellUrl, { cache: "reload", credentials: "omit" });
    if (!isCacheableShell(response)) throw new Error("El shell " + shellUrl + " no está disponible para precachear.");
    const html = await response.clone().text();
    await cache.put(shellUrl, response);
    queue.push(...(html.match(/\/_astro\/[A-Za-z0-9_.\-]+\.(?:js|css)/g) ?? []));
  }
  const referenced = new Set(queue);
  const seen = new Set();
  while (queue.length && seen.size < 400) {
    const path = queue.shift();
    if (seen.has(path)) continue;
    seen.add(path);
    const asset = await fetch(path, { credentials: "omit" });
    if (!asset.ok) {
      if (asset.status === 404 && !referenced.has(path)) continue;
      throw new Error("No se pudo precachear " + path);
    }
    await cache.put(path, asset.clone());
    if (path.endsWith(".js")) {
      const code = await asset.text();
      for (const match of code.matchAll(/["'](\.\/[A-Za-z0-9_.\-]+\.(?:js|css))["']/g)) {
        const next = "/_astro/" + match[1].slice(2);
        if (!seen.has(next)) queue.push(next);
      }
    }
  }
}

// La instalación es atómica: si algún shell o sus recursos no se pueden cachear, waitUntil rechaza y el navegador
// conserva el worker (y la caché con los shells) anteriores. No hay skipWaiting automático: la activación la decide
// el usuario con "Nueva versión disponible → Actualizar", para que las pestañas abiertas no pierdan chunks.
self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll(PRECACHE_URLS);
    await precacheShells(cache);
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    // Las cachés anteriores (con los shells que usa quien está sin conexión) solo se borran si la nueva ya tiene TODOS.
    const current = await caches.open(CACHE_NAME);
    const present = await Promise.all(SHELL_URLS.map((url) => current.match(url)));
    if (present.every(Boolean)) {
      const cacheNames = await caches.keys();
      await Promise.all(cacheNames
        .filter((name) => name.startsWith(`${CACHE_PREFIX}-`) && name !== CACHE_NAME)
        .map((name) => caches.delete(name)));
    }
    await self.clients.claim();
  })());
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") void self.skipWaiting();
});

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok && response.type === "basic") {
    const cache = await caches.open(CACHE_NAME);
    await cache.put(request, response.clone());
  }
  return response;
}

async function networkFirst(request) {
  try {
    const response = await fetch(request);
    if (response.ok && response.type === "basic") {
      const cache = await caches.open(CACHE_NAME);
      await cache.put(request, response.clone());
    }
    return response;
  } catch (error) {
    const cached = await caches.match(request);
    if (cached) return cached;
    throw error;
  }
}

// Sin red el service worker no puede saber el rol del usuario: el respaldo es POR RUTA.
//  - /turno y /reportes* → shell del Operario; /consulta-offline → consulta de managers y auditores;
//  - /iniciar-sesion, /acceso-offline, / y /dashboard → /acceso-offline (inicio de sesión sin conexión: tras entrar,
//    el propio shell navega por el rol guardado);
//  - cualquier otra ruta (administración, notificaciones...) muestra /offline.html.
function offlineFallbackFor(pathname) {
  if (pathname === SHELL_URL || pathname === "/reportes" || pathname.startsWith("/reportes/")) return SHELL_URL;
  if (pathname === "/consulta-offline") return "/consulta-offline";
  if (pathname === "/iniciar-sesion" || pathname === "/acceso-offline" || pathname === "/" || pathname === "/dashboard") return "/acceso-offline";
  return "/offline.html";
}

async function navigate(request, url) {
  try {
    const response = await fetch(request);
    if (SHELL_URLS.includes(url.pathname) && isCacheableShell(response)) {
      const cache = await caches.open(CACHE_NAME);
      await cache.put(url.pathname, response.clone());
    }
    return response;
  } catch {
    const fallback = await caches.match(offlineFallbackFor(url.pathname)) ?? await caches.match("/offline.html");
    return fallback ?? Response.error();
  }
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;

  if (request.mode === "navigate") {
    event.respondWith(navigate(request, url));
    return;
  }

  if (url.pathname.startsWith("/_astro/")) {
    event.respondWith(cacheFirst(request));
    return;
  }

  if (url.pathname === "/manifest.webmanifest") {
    event.respondWith(networkFirst(request));
    return;
  }

  if (ICON_URLS.has(url.pathname)) event.respondWith(cacheFirst(request));
});
