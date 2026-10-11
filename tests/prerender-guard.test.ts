/// <reference types="bun" />
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

// Solo tres páginas pueden ser prerenderizadas (HTML estático SIN datos, precacheado por el service worker):
//  - turno.astro (Operario, Phase 7a), consulta-offline.astro (managers y auditores, Phase 8 / T094) y
//  - acceso-offline.astro (inicio de sesión sin conexión, Phase 8 / T092-T095: sustituye a la página SSR /iniciar-sesion,
//    que lleva mensajes del servidor y no puede cachearse).
// Cualquier otra con `prerender = true` se serviría sin pasar por el middleware ni la autorización y podría exponer
// datos: este test lo impide. Ninguna de las tres incluye datos en su HTML (se prueba abajo).
const pagesDir = fileURLToPath(new URL("../src/pages", import.meta.url));
function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

describe("páginas prerenderizadas", () => {
  test("solo turno, consulta-offline y acceso-offline declaran prerender = true", () => {
    const prerendered = walk(pagesDir)
      .filter((file) => /\.(astro|ts|tsx|js|mjs|md|mdx)$/.test(file))
      .filter((file) => /export\s+const\s+prerender\s*=\s*true/.test(readFileSync(file, "utf8")))
      .map((file) => relative(pagesDir, file).split("\\").join("/"));
    expect(prerendered.sort()).toEqual(["acceso-offline.astro", "consulta-offline.astro", "turno.astro"]);
  });

  test("las tres páginas prerenderizadas no leen sesión, cookies ni parámetros de la petición", () => {
    for (const name of ["turno.astro", "consulta-offline.astro", "acceso-offline.astro"]) {
      const source = readFileSync(join(pagesDir, name), "utf8");
      expect(source).not.toMatch(/Astro\.(locals|cookies|request|url)/);
      expect(source).not.toMatch(/supabase/i);
    }
  });
});
