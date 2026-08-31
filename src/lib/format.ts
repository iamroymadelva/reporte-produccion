export function formatDate(value: string | null | undefined) {
  if (!value) return "—";
  const calendarDate = /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T12:00:00Z` : value;
  return new Intl.DateTimeFormat("es-CO", { dateStyle: "medium", timeZone: "America/Bogota" }).format(new Date(calendarDate));
}

export function formatDateTime(value: string | null | undefined) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("es-CO", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "America/Bogota",
  }).format(new Date(value));
}

export function formatNumber(value: number | string | null | undefined, digits = 2) {
  if (value === null || value === undefined || value === "") return "—";
  return new Intl.NumberFormat("es-CO", { maximumFractionDigits: digits }).format(Number(value));
}

export function formatPercent(value: number | string | null | undefined) {
  if (value === null || value === undefined || value === "") return "—";
  return new Intl.NumberFormat("es-CO", { style: "percent", maximumFractionDigits: 1 }).format(Number(value));
}

export function formatDuration(seconds: number | null | undefined) {
  if (seconds === null || seconds === undefined) return "En curso";
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remaining = seconds % 60;
  return [hours ? `${hours} h` : "", minutes ? `${minutes} min` : "", `${remaining} s`].filter(Boolean).join(" ");
}
