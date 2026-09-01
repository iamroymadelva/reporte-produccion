import type { APIRoute } from "astro";

export const HEAD: APIRoute = () => new Response(null, {
  status: 204,
  headers: { "Cache-Control": "no-store" },
});
