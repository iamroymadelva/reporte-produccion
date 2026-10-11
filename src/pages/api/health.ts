import type { APIRoute } from "astro";

export const HEAD: APIRoute = () => new Response(null, {
  status: 204,
  // X-Server-Time: reloj del servidor, para atar la matrícula offline a un inicio de sesión real sin depender del reloj del dispositivo.
  headers: { "Cache-Control": "no-store", "X-Server-Time": new Date().toISOString() },
});
