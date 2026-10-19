import { defineMiddleware } from "astro:middleware";
import { getAuthContext, isManager, isRoot, hasRole } from "./lib/auth";

const publicPaths = new Set([
  "/iniciar-sesion",
  // Shell estático del acceso sin conexión (prerenderizado, sin datos): público como /iniciar-sesion.
  "/acceso-offline",
  "/api/auth/login",
  "/api/auth/logout",
  // Phase 8: la ruta decide entre 401 (sin sesión) y 403 INACTIVE (sesión válida, perfil inactivo).
  "/api/auth/session-info",
]);

function noStore(response: Response) {
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}

function inSection(pathname: string, base: string) {
  return pathname === base || pathname.startsWith(`${base}/`);
}

export const onRequest = defineMiddleware(async (context, next) => {
  const pathname = context.url.pathname;
  // Páginas prerenderizadas (/turno, /consulta-offline, /acceso-offline): HTML estático sin datos; la autorización la
  // hacen la API y la isla.
  if ((context as { isPrerendered?: boolean }).isPrerendered) return next();
  if (pathname === "/api/health" || pathname.startsWith("/_astro/")) return next();

  const isPublic = publicPaths.has(pathname);

  try {
    context.locals.auth = await getAuthContext(context.request, context.cookies);
  } catch {
    context.locals.auth = null;
  }

  if (!isPublic && !context.locals.auth) {
    if (pathname.startsWith("/api/")) {
      return noStore(new Response(JSON.stringify({ error: "Debes iniciar sesión." }), {
        status: 401,
        headers: { "Content-Type": "application/json; charset=utf-8" },
      }));
    }
    return noStore(context.redirect("/iniciar-sesion"));
  }

  const auth = context.locals.auth ?? null;
  const isApi = pathname.startsWith("/api/");
  const deny = (message: string) => isApi
    ? noStore(new Response(JSON.stringify({ error: message }), {
        status: 403,
        headers: { "Content-Type": "application/json; charset=utf-8" },
      }))
    : noStore(context.redirect("/reportes"));

  // Historial administrativo: solo ROOT.
  if (inSection(pathname, "/administracion/historial") || inSection(pathname, "/api/admin/audit")) {
    if (!isRoot(auth)) return deny("Solo el administrador raíz puede ver el historial administrativo.");
  } else if (inSection(pathname, "/administracion") || inSection(pathname, "/api/admin")) {
    if (!isManager(auth)) return deny("No tienes permisos de administración.");
  } else if (inSection(pathname, "/turno")) {
    if (!hasRole(auth, "OPERATOR")) return deny("Esta pantalla es solo para operarios.");
  } else if (inSection(pathname, "/api/dashboard")) {
    if (!isManager(auth) && !hasRole(auth, "VIEWER")) return deny("El tablero en vivo es solo para coordinadores y auditores.");
  } else if (inSection(pathname, "/indicadores") || inSection(pathname, "/api/indicadores")) {
    if (!isManager(auth) && !hasRole(auth, "VIEWER")) return deny("Los indicadores son solo para coordinadores y auditores.");
  } else if (inSection(pathname, "/consulta-offline") || inSection(pathname, "/api/offline/overview")) {
    if (!isManager(auth) && !hasRole(auth, "VIEWER")) return deny("No tienes permisos para esta consulta.");
  }

  return noStore(await next());
});
