/**
 * SC-006: tiempo de exportar a Excel un mes sembrado (scripts/seed-month.sql) contra un servidor de desarrollo LOCAL.
 *   BASE=http://127.0.0.1:4399 bun scripts/measure-sc006.ts
 */
import ExcelJS from "exceljs";

const BASE = process.env.BASE ?? "http://127.0.0.1:4399";
const FROM = process.env.FROM ?? "2026-09-10";
const TO = process.env.TO ?? "2026-10-09";
const LIMIT_MS = 30_000;

async function login(username: string) {
  const jar = new Map<string, string>();
  const response = await fetch(`${BASE}/api/auth/login`, {
    method: "POST", redirect: "manual", headers: { "Content-Type": "application/x-www-form-urlencoded", Origin: BASE },
    body: new URLSearchParams({ username, password: "Planta2026!" }).toString(),
  });
  for (const line of (response.headers as any).getSetCookie?.() ?? []) {
    const [pair] = String(line).split(";");
    const index = pair.indexOf("=");
    jar.set(pair.slice(0, index).trim(), pair.slice(index + 1).trim());
  }
  return [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
}

let failed = false;
for (const user of ["coord1", "auditor1"]) {
  const cookie = await login(user);
  for (let run = 1; run <= 3; run++) {
    const started = performance.now();
    const response = await fetch(`${BASE}/api/reports/export?from=${FROM}&to=${TO}`, { headers: { Cookie: cookie, Origin: BASE } });
    const bytes = new Uint8Array(await response.arrayBuffer());
    const ms = Math.round(performance.now() - started);
    let detail = "";
    if (response.status === 200) {
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(bytes.buffer as ArrayBuffer);
      detail = workbook.worksheets.map((sheet) => `${sheet.name}=${sheet.rowCount}`).join(", ");
    } else {
      detail = new TextDecoder().decode(bytes).slice(0, 200);
    }
    const ok = response.status === 200 && ms < LIMIT_MS;
    if (!ok) failed = true;
    console.log(`${ok ? "OK  " : "FAIL"} ${user} corrida ${run}: HTTP ${response.status} en ${ms} ms, ${(bytes.byteLength / 1024).toFixed(0)} KiB. Filas por hoja: ${detail}`);
  }
}
console.log(failed ? "SC-006 NO CUMPLIDO" : `SC-006 cumplido en local (limite ${LIMIT_MS / 1000} s)`);
process.exit(failed ? 1 : 0);
