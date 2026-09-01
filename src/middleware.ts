import { defineMiddleware } from "astro:middleware";
import { getAuthContext } from "./lib/auth";

const publicPaths = new Set([
  "/iniciar-sesion",
  "/recuperar-contrasena",
  "/auth/confirmar",
  "/api/auth/login",
  "/api/auth/logout",
  "/api/auth/recovery",
]);

function noStore(response: Response) {
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}

export const onRequest = defineMiddleware(async (context, next) => {
  const pathname = context.url.pathname;
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

  if (pathname.startsWith("/administracion") || pathname.startsWith("/api/admin")) {
    if (context.locals.auth?.profile.role !== "ADMINISTRATOR") {
      if (pathname.startsWith("/api/")) {
        return noStore(new Response(JSON.stringify({ error: "No tienes permisos de administración." }), {
          status: 403,
          headers: { "Content-Type": "application/json; charset=utf-8" },
        }));
      }
      return noStore(context.redirect("/reportes"));
    }
  }

  return noStore(await next());
});
