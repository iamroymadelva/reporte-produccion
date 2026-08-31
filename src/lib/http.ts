export function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

export function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  return "Ocurrió un error inesperado.";
}

export function redirectWithMessage(path: string, key: "error" | "ok", message: string) {
  const url = new URL(path, "http://local");
  url.searchParams.set(key, message);
  return `${url.pathname}${url.search}`;
}
