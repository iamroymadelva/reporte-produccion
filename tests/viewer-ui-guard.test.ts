import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { isManagerRole } from "../src/lib/auth";

// Guardas estáticas (T064, FR-032): el auditor ve todo y no recibe ningún control de escritura.
const source = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

describe("VIEWER: solo lectura en la interfaz", () => {
  test("el auditor no es manager", () => {
    expect(isManagerRole("VIEWER")).toBe(false);
  });

  test("el dashboard muestra al auditor los KPIs de todos los estados, paradas activas y fuera de turno", () => {
    const dashboard = source("src/pages/dashboard.astro");
    expect(dashboard).not.toContain("!isViewer");
    for (const key of ["DRAFT", "SUBMITTED", "CLOSED", "CANCELLED", "ACTIVE_STOP", "OFF_SHIFT"]) {
      expect(dashboard).toMatch(new RegExp(`key: "${key}", show: (true|!isOperator)`));
    }
  });

  test("el detalle solo entrega controles de escritura a managers u operario autor", () => {
    const detail = source("src/pages/reportes/[id].astro");
    expect(detail).toContain("const adminCorrection = isManagerRole(auth.profile.role);");
    expect(detail).toContain("isManager={adminCorrection}");
    expect(detail).toContain("const editable = isOwnerDraft || (adminCorrection && correctable);");
    expect(detail).toContain('const isOwnerDraft = auth.profile.role === "OPERATOR"');
  });

  test("el listado solo ofrece abrir reportes al operario", () => {
    const list = source("src/pages/reportes/index.astro");
    expect(list).toContain('{auth.profile.role === "OPERATOR" && (\n      <Card className="rounded-2xl gap-0 p-5">');
    expect(list).not.toMatch(/action="\/api\/reports\/[^"]*(approve|cancel|correct)/);
  });
});
