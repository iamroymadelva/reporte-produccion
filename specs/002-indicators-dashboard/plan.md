# Implementation Plan: Tablero de Indicadores de Producción

**Branch**: `002-indicators-dashboard` | **Date**: 2026-10-19 | **Spec**: [spec.md](spec.md)
**Input**: `specs/002-indicators-dashboard/spec.md` (incluye la sección Clarifications del 2026-10-19)

## Summary

Página `/indicadores` (coordinador, auditor y ROOT) con filtro de rango (7/30/90 días de fecha operativa, Bogotá), cuatro tarjetas y tres gráficas (área por día, barras por máquina, dona por categoría). Un solo cálculo en la base de datos: la función `public.indicators_summary(p_from date, p_to date) returns jsonb` (`security invoker`, valida rol) devuelve tarjetas, serie diaria, top 10 de máquinas y categorías ya agrupadas. `GET /api/indicadores?rango=7d|30d|90d` valida sesión, rol y rango, calcula las fechas en el servidor y llama a la función con la sesión del usuario. Una isla React (`IndicatorsDashboard`) pide los datos al montar y al cambiar el rango, y pinta con los componentes de gráficas de shadcn/ui (Recharts). Se agrega un script de semilla de demo solo local y pruebas pgTAP + `bun test`.

Decisiones de fondo en [research.md](research.md); forma de la respuesta en [contracts/](contracts/); modelo en [data-model.md](data-model.md); verificación en [quickstart.md](quickstart.md).

## Technical Context

**Language/Version**: TypeScript 5.9; SQL/PLpgSQL (PostgreSQL de Supabase local)
**Primary Dependencies**: Astro 7 SSR (`@astrojs/vercel`), React 19, Tailwind 4, shadcn/ui (new-york, ya instalado: `Card`, `Select`, `Skeleton`, `Alert`), `lucide-react`. **Nueva**: `recharts` (+ `src/components/ui/chart.tsx` de shadcn). Ver research R-01.
**Storage**: PostgreSQL con RLS. Sin tablas nuevas; 1 función, 1 índice.
**Testing**: `bun test` (happy-dom), pgTAP (`bun run db:test`), `bunx astro check`, `bun run build`
**Target Platform**: Vercel serverless + navegadores modernos; móvil 375 px y escritorio; claro/oscuro
**Project Type**: Aplicación web (Astro SSR + islas React) con migraciones Supabase
**Performance Goals**: SC-001 — tarjetas y gráficas en < 3 s con volumen del piloto (una sola consulta agregada, ≤ 90 días)
**Constraints**: es-CO / America/Bogota; sin caché de datos autenticados (`Cache-Control: private, no-store`); la página no entra al service worker; la migración NUNCA se aplica a producción
**Scale/Scope**: decenas de máquinas, miles de reportes en 3 meses; 1 página, 1 endpoint, 1 función SQL

No quedan `NEEDS CLARIFICATION`. Dos decisiones de cálculo que el usuario no especificó están en research R-03 y R-04 (turno que cruza medianoche; aprobación anterior al fin de turno).

## Constitution Check

*Constitución v1.0.0. Evaluado antes de la Fase 0 y re-evaluado tras el diseño de la Fase 1.*

| Principio / sección | Pre | Post | Evidencia |
|---|---|---|---|
| I. Autorización en el servidor | ✅ | ✅ | La función es `security invoker` (RLS manda) **y** exige `is_manager()` o `VIEWER` (OPERATOR → `42501`); el endpoint re-valida rol; el middleware protege página y API; ocultar el menú es solo comodidad. Pruebas de solicitud directa (pgTAP y API). Sin `service_role`. |
| II. Trazabilidad e integridad | ✅ | ✅ | Solo lectura: no escribe en reportes, paradas ni auditoría. Las lecturas no se auditan (igual que el resto, ver DATA_MODEL `report_audit_log`). |
| III. Offline seguro | ✅ N/A | ✅ N/A | Página solo en línea; no se cachea HTML ni datos autenticados; no entra al precache del service worker. Sin cambio en `CACHE_VERSION`. |
| IV. Pruebas como evidencia | ✅ | ✅ | pgTAP de la función (exclusiones, día Bogotá, cruce de medianoche, operario) + `bun test` del endpoint y de la isla + formato. Entrega requiere `bun test`, `db:test`, `astro check`, `build` en verde. |
| V. Simplicidad | ⚠️ | ⚠️ | Dependencia de runtime nueva (`recharts`): justificada en R-01 y registrada abajo. Resto reutiliza el stack. Migración sin `ALTER TYPE`, reproducible con `db:reset`. |
| Plataforma (es-CO, móvil, Vercel) | ✅ | ✅ | Todo en español; 375 px sin desplazamiento horizontal; sin conexiones largas. |
| Flujo de desarrollo | ✅ | ✅ | Spec → clarify → plan. Implementación por `executor`, revisión GO/NO-GO por Opus. Sin commit/push salvo petición. |

## Project Structure

### Documentation (this feature)

```text
specs/002-indicators-dashboard/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   └── http-api.md          # GET /api/indicadores + RPC indicators_summary
├── checklists/requirements.md
└── tasks.md                 # lo genera /speckit-tasks
```

### Source Code (repository root)

```text
supabase/
├── migrations/20261019000100_indicators_summary.sql   # función + índice (nombre siguiente al orden existente)
└── tests/indicators_summary.test.sql                  # pgTAP

scripts/
└── seed-demo-indicators.sql                           # semilla de demo, SOLO local (con guardas)

src/
├── lib/indicators.ts                                  # rangos 7d/30d/90d → fechas Bogotá, tipos de la respuesta, formateo (h con 1 decimal, % sin decimales)
├── pages/
│   ├── indicadores.astro                              # página (BaseLayout + PageHeader + isla)
│   └── api/indicadores.ts                             # GET /api/indicadores
├── components/
│   ├── indicators/IndicatorsDashboard.tsx             # única isla (client:load)
│   └── ui/chart.tsx                                   # shadcn chart (Recharts wrapper)
├── components/shell/nav-config.ts                     # ítem "Indicadores" (ROOT, ADMINISTRATOR, VIEWER) + breadcrumb
└── middleware.ts                                      # /indicadores y /api/indicadores: manager o VIEWER

tests/
├── indicators-api.test.ts
├── indicators-lib.test.ts
└── indicators-dashboard.test.tsx
```

**Structure Decision**: Se mantiene el layout existente (Astro `src/pages` + islas en `src/components/<area>` + `src/lib` + `supabase/`). La carpeta `src/components/indicators/` sigue el patrón de `realtime/`, `reports/`, etc. La semilla va en `scripts/` junto a `seed-month.sql` (no en `supabase/seed.sql`, que corre en cada `db:reset` y en las pruebas).

## Mejoras no indispensables (fuera del alcance de la demo)

Anotadas para después; **no** se hacen ahora:

1. Datos iniciales renderizados en el servidor (evita el parpadeo de carga) en vez de pedirlos al montar.
2. Texto de ayuda para el nuevo ítem en `help-content.ts` / `/ayuda`.
3. Comparación contra el periodo anterior (variación ▲▼ en las tarjetas).
4. Exportar a Excel/imagen, filtros por máquina/turno, tiempo real, eficiencia (ya declarados fuera de alcance en la spec).
5. Caché corta en servidor del resultado por (rol, rango) si el volumen crece.
6. Evaluar si el índice nuevo de `report_date` también debe beneficiar `/api/dashboard/summary` y el listado (probablemente sí, sin cambios de código).
7. Prueba visual automatizada (capturas 375 px claro/oscuro); en la demo se verifica a mano (quickstart).
8. Corregir el script `auto-commit.ps1` de la extensión git (pendiente acordado para después de la demo).

## Complexity Tracking

| Violación | Por qué se necesita | Alternativa más simple rechazada porque |
|---|---|---|
| Nueva dependencia de runtime `recharts` (V) | El usuario pidió explícitamente los componentes de gráficas de shadcn/ui, que son un wrapper de Recharts; área interactiva, barras, dona y tooltips accesibles vienen resueltos. | SVG a mano: más código, tooltips/táctil/modo oscuro por construir y probar para una demo en 1 día. Detalle en research R-01. |
