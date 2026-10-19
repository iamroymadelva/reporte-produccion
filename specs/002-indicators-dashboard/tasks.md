---
description: "Lista de tareas: Tablero de Indicadores de Producción"
---

# Tasks: Tablero de Indicadores de Producción

**Input**: `specs/002-indicators-dashboard/` — [plan.md](plan.md), [spec.md](spec.md), [research.md](research.md), [data-model.md](data-model.md), [contracts/http-api.md](contracts/http-api.md), [quickstart.md](quickstart.md)
**Rama**: `002-indicators-dashboard`
**Pruebas**: OBLIGATORIAS (Principio IV: control de acceso y reglas en SQL/API) y solicitadas por el usuario. pgTAP para la función; `bun test` para endpoint, formato e isla.

## Reglas de ejecución (flujo obligatorio del proyecto)

- Cada tarea la implementa un agente `executor` (Sonnet); **Opus revisa el diff real y corre las verificaciones y da GO/NO-GO al cierre de cada fase** (marcadas «🔒 Revisión»). Quien implementa no se revisa a sí mismo.
- **Nunca** aplicar la migración a producción ni usar `.env.local`. Todo contra el stack local (`bun run db:start`, `bun run db:reset`, `bun run dev`). Al terminar sesiones de dev: `bunx astro dev stop`.
- No hacer commit ni push salvo que el usuario lo pida.
- Textos de interfaz en español (es-CO); horas con 1 decimal (`12,5 h`) y porcentajes sin decimales, vía `src/lib/indicators.ts`.
- `[P]` = paralelizable (archivos distintos, sin dependencia pendiente). Las tareas que tocan el mismo archivo van en secuencia.

## Formato: `- [ ] ID [P?] [Story?] Descripción con ruta`

Historias (spec.md): **US1** tarjetas y filtro de rango (P1) · **US4** acceso restringido y permisos (P1) · **US2** gráficas de área y barras (P2) · **US3** dona por categoría (P3). Orden de fases por prioridad; US4 va antes de US2/US3 porque es un requisito de seguridad previo a mostrar datos.

---

## Phase 1: Setup

**Propósito**: dependencia y componente base de gráficas.

- [X] T001 Instalar `recharts` con `bun add recharts` y agregar `src/components/ui/chart.tsx` (componente oficial de gráficas de shadcn: `ChartContainer`, `ChartTooltip`, `ChartTooltipContent`, `ChartLegend`, `ChartLegendContent`) usando `bunx shadcn@latest add chart` o copiándolo, respetando `components.json` (alias `@/components/ui`). Confirmar compatibilidad con React 19: `bun run build` y `bunx astro check` deben pasar; si hay conflicto de `react-is`, resolver con `overrides` en `package.json` y anotarlo en `research.md` R-01. **No** modificar `src/styles/global.css` ni otros componentes `ui/` existentes (si la CLI intenta sobrescribirlos, revertir esos cambios). Archivos: `package.json`, `bun.lock`, `src/components/ui/chart.tsx`.

---

## Phase 2: Foundational (bloquea todas las historias)

**Propósito**: función SQL completa, utilidades y endpoint. Todas las historias consumen esto.

**⚠️ Ninguna historia empieza hasta terminar esta fase.**

- [X] T002 Crear la migración `supabase/migrations/20261019000100_indicators_summary.sql` con: (a) `create index production_reports_report_date_status_idx on public.production_reports (report_date, status);` (b) `public.indicators_summary(p_from date, p_to date) returns jsonb` — `language plpgsql stable security invoker set search_path = ''`; primero valida rol (`private.is_manager()` o `private.current_user_role() = 'VIEWER'`, si no `raise exception … using errcode = '42501'`) y rango (`p_from <= p_to`, ≤ 366 días, si no `22023`); (c) `revoke all on function … from public, anon; grant execute … to authenticated;`. Lógica exactamente como research R-03/R-04 y contracts/http-api.md: reportes `status in ('SUBMITTED','CLOSED')` con `report_date between p_from and p_to`; paradas con `ended_at is not null and cancelled_at is null and duration_seconds is not null` sumadas completas a la fecha de su reporte; `cards` = `reports`, `approved`, `approvedRatio` (null si 0 reportes), `avgApprovalSeconds` (solo `CLOSED` con turno resoluble; `shift_end = (report_date + shifts.end_time) at time zone 'America/Bogota'` + 1 día si `end_time <= start_time`; `greatest(approved_at − shift_end, 0)`; null si ninguno), `stopSeconds`; `daily` con `generate_series(p_from, p_to, '1 day')` + left join (un elemento por día, 0 si no hay paradas, orden ascendente); `machines` top 10 por `seconds desc, code asc`, solo `seconds > 0`; `categories` (kind `category`/`uncategorized`/`other`): si hay más de 6 grupos con segundos > 0, los 5 mayores + `other` con la suma del resto (al final), si no todos, orden descendente; suma = `stopSeconds`. Salida: `{ range:{from,to,days}, cards, daily, machines, categories }` con tiempos en segundos enteros. Sin `ALTER TYPE`. Verificar con `bun run db:reset` (debe aplicar sin errores).
- [X] T003 [P] Crear `src/lib/indicators.ts`: tipo `IndicatorsRangeKey = "7d" | "30d" | "90d"` y `INDICATOR_RANGES` (7, 30, 90 días; rótulos «Últimos 7 días», «Últimos 30 días», «Últimos 3 meses»; defecto `30d`); `resolveIndicatorsRange(key, today = getBogotaDateKey())` → `{ key, from, to, days }` con `to = today` y `from = to − (días − 1)` calculado sobre calendario a mediodía UTC (patrón de `src/pages/api/dashboard/summary.ts`: `T12:00:00Z`), sin depender de la zona del servidor; `isIndicatorsRangeKey(value)` estricto (sensible a mayúsculas); tipos TypeScript de la respuesta según contracts/http-api.md; `secondsToHours`, `formatHours(seconds)` (→ `12,5 h`, 1 decimal, es-CO), `formatRatioPercent(ratio)` (→ `85 %` con `Intl.NumberFormat("es-CO", { style: "percent", maximumFractionDigits: 0 })`; `null` → `—`), `formatAvgApprovalHours(seconds | null)` (null → `—`), `CATEGORY_LABELS`/`categoryLabel(segment)` («Sin categoría», «Otras», o el nombre). **No** modificar `formatPercent`/`formatNumber` de `src/lib/format.ts`.
- [X] T004 Crear `src/pages/api/indicadores.ts` (depende de T002, T003): `GET: APIRoute` como `src/pages/api/dashboard/summary.ts` — 401 sin `locals.auth`; 403 si el rol no es `ROOT`/`ADMINISTRATOR`/`VIEWER` **sin consultar la base**; 422 si `rango` no pasa `isIndicatorsRangeKey`; calcula fechas con `resolveIndicatorsRange`; llama `supabase.rpc("indicators_summary", { p_from, p_to })` con `createSupabaseServerClient(request, cookies)` (sesión del usuario, nunca `service_role`); error de RPC → `console.error` y 500 con «No fue posible cargar los indicadores.»; 200 con la respuesta de contracts/http-api.md (`range.key`, `serverTime`). Todas las respuestas con `Cache-Control: private, no-store`. Mensajes exactos en contracts/http-api.md.

**Checkpoint**: `bun run db:reset` aplica la migración; `select public.indicators_summary(current_date - 29, current_date)` responde con JSON vacío pero bien formado. 

---

## Phase 3: User Story 1 — Resumen del periodo en tarjetas con filtro de rango (P1) 🎯 MVP

**Objetivo**: el usuario abre «Indicadores», ve las cuatro tarjetas del periodo (30 días por defecto) y cambia el rango.

**Prueba independiente**: con datos de prueba conocidos, abrir la página como coordinador y verificar las cuatro tarjetas contra el cálculo manual en los tres rangos.

### Pruebas US1

- [X] T005 [US1] Crear `supabase/tests/indicators_summary.test.sql` (pgTAP; patrón de `viewer_read_only.test.sql`: `begin; select no_plan(); \set skip_selftest 1; \ir helpers/auth_as.sql;`, usuarios ROOT/ADMINISTRATOR/VIEWER/OPERATOR de prueba con UUID propios, máquinas, categorías, turnos propios con `insert`, y filas con `set local session_replication_role = replica` para insertar reportes/paradas sintéticos; usar fechas de 2033 y folios `RPT-2033-9xxxxx` para no chocar con otros datos; terminar con `select * from finish(); rollback;`). Fixtures compartidos para todas las historias + casos de US1: (a) cuenta solo `SUBMITTED`+`CLOSED` y excluye `DRAFT` y `CANCELLED` en `cards.reports`; (b) `approvedRatio = closed/(submitted+closed)`, `null` sin reportes, `0` con reportes y ninguno aprobado; (c) `avgApprovalSeconds` con turno diurno, con **turno nocturno que cruza la medianoche** (fin = `report_date + 1`), con aprobación anterior al fin del turno (→ 0) y con reporte sin turno (excluido del promedio pero contado); `null` si no hay `CLOSED`; (d) ejecutar como ADMINISTRATOR con `tests.auth_as(...)`.
- [X] T006 [P] [US1] Crear `tests/indicators-lib.test.ts`: `resolveIndicatorsRange` para `7d/30d/90d` con `today` fijo (incluye cruce de mes y de año, y el día 2026-03-01 para validar no-bisiesto), `to = today` y `days` correctos; `isIndicatorsRangeKey` rechaza `"15d"`, `"30D"`, `""`, `null`; `formatHours(45000)` → `12,5 h`; `formatHours(0)` → `0,0 h`; `formatRatioPercent(0.846)` → `85 %`, `null` → `—`; `formatAvgApprovalHours(null)` → `—`.
- [X] T007 [P] [US1] Crear `tests/indicators-api.test.ts` (mock de `../src/lib/supabase/server` como `tests/dashboard-summary-api.test.ts`, esta vez con `rpc`): 200 devuelve el JSON del RPC más `range.key` y `serverTime`; el RPC se llama con `p_from`/`p_to` esperados por rango (calculados con `resolveIndicatorsRange`, no con el reloj del navegador); error de RPC → 500 con el mensaje genérico; cabecera `Cache-Control: private, no-store` en todas las respuestas. (Los casos 401/403/422 van en US4/T012.)
- [X] T008 [P] [US1] Crear `tests/indicators-dashboard.test.tsx` (happy-dom, patrón de `tests/live-dashboard.test.tsx`; mockear `fetch`): al montar pide `/api/indicadores?rango=30d` y muestra las cuatro tarjetas con valores formateados («Reportes del periodo», porcentaje de aprobados, tiempo promedio en horas, horas totales de parada); cambiar el `Select` a «Últimos 7 días» vuelve a pedir `rango=7d` y aborta la petición anterior; estado de carga con esqueletos; error con botón «Reintentar»; con datos vacíos las tarjetas muestran `0` y `—`.

### Implementación US1

- [X] T009 [P] [US1] Crear `src/components/indicators/IndicatorCards.tsx`: cuatro `Card` de shadcn («Reportes del periodo», «Reportes aprobados» con `%`, «Tiempo hasta aprobación» con horas y descripción «Promedio desde el fin del turno», «Horas de parada»), usando `formatHours`/`formatRatioPercent`/`formatAvgApprovalHours`; cuadrícula 1 columna a 375 px, 2 en `sm`, 4 en `lg`; props tipadas con `src/lib/indicators.ts`; versión esqueleto con `Skeleton`.
- [X] T010 [US1] Crear `src/components/indicators/IndicatorsDashboard.tsx` (única isla, depende de T003/T004/T009): estado `range` (defecto `30d`), `status` (`loading|ready|error`), `data`; `useEffect` que pide `/api/indicadores?rango=…` con `AbortController` (cancela la previa al cambiar el rango, ignora respuestas de rangos viejos); `Select` de shadcn arriba a la derecha (ancho completo en móvil) con las tres opciones; renderiza `IndicatorCards`; error → `Alert` en español con botón «Reintentar»; deja contenedores/slots para las gráficas de US2 y US3 (sin implementarlas aún). Sin `localStorage` ni caché de datos autenticados.
- [X] T011 [US1] Crear `src/pages/indicadores.astro`: `BaseLayout` + `PageHeader` (título «Indicadores», descripción corta del propósito) + `<IndicatorsDashboard client:load />`, siguiendo `src/pages/dashboard.astro` (página SSR, no prerenderizada).

**🔒 Revisión US1**: `bun run db:test` (casos de T005), `bun test tests/indicators-*.test.*`, `bunx astro check`, recorrido manual de las tarjetas con `coord1` tras sembrar datos mínimos (o con el stack vacío: tarjetas en 0/«—»). GO/NO-GO de Opus.

---

## Phase 4: User Story 4 — Acceso restringido y datos según permisos (P1)

**Objetivo**: solo coordinadores, auditores y ROOT ven y abren el tablero; las cifras salen de lo que la RLS del usuario permite.

**Prueba independiente**: iniciar sesión con cada rol y comprobar menú, acceso por URL, API directa y RPC directa.

### Pruebas US4

- [X] T012 [P] [US4] Ampliar `tests/indicators-api.test.ts` (tras T007; mismo archivo → secuencial respecto a T007): 401 sin sesión; 403 para `OPERATOR` **sin llamar al RPC** (verificar que `rpc` no se invocó); 422 con `rango` ausente, `15d`, `30D`, `7d ` y vacío; 200 para `ROOT`, `ADMINISTRATOR` y `VIEWER`.
- [X] T013 [P] [US4] En `tests/role-access.test.ts`, agregar a la matriz `{ path: "/indicadores", api: false, allowed: ["ROOT", "ADMINISTRATOR", "VIEWER"] }` y `{ path: "/api/indicadores", api: true, allowed: ["ROOT", "ADMINISTRATOR", "VIEWER"] }`; agregar `/indicadores` a la lista de páginas que redirigen a `/iniciar-sesion` sin sesión y `/api/indicadores` a las que dan 401.
- [X] T014 [P] [US4] En `tests/ui-shell.test.tsx` (bloque `nav-config`): comprobar que `navForRole` incluye «Indicadores» (`/indicadores`) en el grupo `operacion` para `ROOT`, `ADMINISTRATOR` y `VIEWER` y **no** para `OPERATOR`; `breadcrumbFor("/indicadores")` → `["Inicio", "Indicadores"]`; `isActivePath`; `mobileTabs` sigue siendo `dashboard, reportes, notificaciones`. Los tests existentes de administración (10/11 enlaces) deben seguir pasando.
- [X] T015 [US4] Ampliar `supabase/tests/indicators_summary.test.sql` (tras T005): como OPERATOR → `throws_ok(..., '42501')`; como `anon` → sin permiso de ejecución (`has_function_privilege('anon', …) = false`); ROOT, ADMINISTRATOR y VIEWER obtienen JSON con datos; `pg_proc.prosecdef = false` (es `security invoker`); rango invertido y rango > 366 días → `22023`.

### Implementación US4

- [X] T016 [US4] En `src/middleware.ts` agregar la rama `else if (inSection(pathname, "/indicadores") || inSection(pathname, "/api/indicadores")) { if (!isManager(auth) && !hasRole(auth, "VIEWER")) return deny("Los indicadores son solo para coordinadores y auditores."); }` junto a la de `/api/dashboard`, sin alterar las demás.
- [X] T017 [US4] En `src/components/shell/nav-config.ts` agregar el ítem `indicadores: NavItem = { title: "Indicadores", href: "/indicadores", icon: ChartColumn (lucide-react), roles: ["ROOT", "ADMINISTRATOR", "VIEWER"] }` al grupo `operacion` (tras Reportes), incluirlo en la lista de `breadcrumbFor` y mantener `mobileTabs` sin cambios (en móvil se llega desde «Más»). Verificar que el ícono existe en la versión instalada de `lucide-react`; si no, usar `BarChart3`.

**🔒 Revisión US4**: `bun run db:test`, `bun test` completo (matriz de roles y shell), prueba manual: `op1` no ve el ítem, `/indicadores` redirige a `/reportes` y `/api/indicadores?rango=30d` da 403; `coord1`, `auditor1`, `root` entran. GO/NO-GO de Opus.

---

## Phase 5: User Story 2 — Gráficas de área (por día) y de barras (por máquina) (P2)

**Objetivo**: ver cuándo y en qué máquinas se concentran las paradas.

**Prueba independiente**: con paradas conocidas en varias máquinas y días, cada punto/barra coincide con la suma manual, con orden y tope de 10.

### Pruebas US2

- [ ] T018 [US2] Ampliar `supabase/tests/indicators_summary.test.sql`: (a) `daily` tiene exactamente `days` elementos ascendentes, con 0 en días sin paradas; suma de `daily` = `cards.stopSeconds`; (b) excluye paradas **abiertas** (`ended_at` nulo) y **canceladas** (`cancelled_at` no nulo); excluye paradas de reportes `DRAFT`/`CANCELLED`; (c) una parada que **cruza la medianoche** (inicia 23:30 y termina 00:30 del día siguiente en Bogotá) cuenta **completa** en el `report_date` de su reporte y nada en el día siguiente; (d) `machines`: máximo 10 con 12 máquinas de prueba, orden descendente con desempate por `code`, solo `seconds > 0`; (e) agrupación por día en hora de Bogotá usando `report_date` (reporte creado cerca de medianoche UTC no cambia de día).
- [ ] T019 [P] [US2] Crear `tests/indicators-charts.test.tsx` (happy-dom): `AreaChartCard` y `MachineBarCard` muestran el mensaje de «sin datos» cuando la serie es todo ceros / lista vacía y **no** montan el gráfico; con datos renderizan el contenedor con `role`/`aria-label` descriptivo y el título; sin medir geometría de Recharts (happy-dom no hace layout).

### Implementación US2

- [ ] T020 [P] [US2] Crear `src/components/indicators/AreaChartCard.tsx`: `Card` con título «Horas de parada por día» y descripción del rango, `ChartContainer` + `AreaChart` de Recharts (patrón «Area Chart – Interactive» de shadcn: gradiente con `var(--chart-1)`, `CartesianGrid` horizontal, eje X con fecha corta `9 oct` formateada en es-CO/`America/Bogota` desde `AAAA-MM-DD` a mediodía UTC, `ChartTooltip` con la fecha completa y el valor en `formatHours`); datos `daily.seconds / 3600`; mensaje «No hay paradas registradas en este periodo.» si todo es 0; sin desbordar a 375 px (`min-w-0`, altura fija ~220 px en móvil); tick del eje X con intervalo automático para 90 días.
- [ ] T021 [P] [US2] Crear `src/components/indicators/MachineBarCard.tsx`: título «Horas de parada por máquina», `BarChart` horizontal (`layout="vertical"`) con `var(--chart-1)` (o `--chart-2` para diferenciarla del área), eje Y con el código de la máquina truncado y tooltip con `code — name` y `formatHours`; ya llega ordenado de mayor a menor (máx. 10); altura proporcional al número de barras; mensaje «No hay paradas por máquina en este periodo.» si la lista está vacía.
- [ ] T022 [US2] Integrar ambas tarjetas en `src/components/indicators/IndicatorsDashboard.tsx` (disposición: área a ancho completo; barras debajo en móvil y junto a la dona en escritorio); esqueletos mientras carga. Depende de T020, T021.

**🔒 Revisión US2**: `bun run db:test`, `bun test`, `astro check`, verificación manual del área y barras con datos reales (necesita la semilla de T028 o datos creados a mano). GO/NO-GO de Opus.

---

## Phase 6: User Story 3 — Dona de distribución por categoría (P3)

**Objetivo**: ver el reparto del tiempo de parada por categoría, con «Sin categoría» y «Otras».

**Prueba independiente**: con 8 categorías más paradas sin categoría, la dona muestra 6 segmentos con «Otras» y el 100 % del tiempo.

### Pruebas US3

- [ ] T023 [US3] Ampliar `supabase/tests/indicators_summary.test.sql`: (a) paradas con `stop_category_id` nulo (insertadas con `session_replication_role = replica`) salen como `kind = 'uncategorized'`; (b) con 8 categorías con tiempo → 6 elementos: 5 mayores + `other` al final con la suma exacta de las 3 menores; (c) con exactamente 6 categorías → 6 elementos, sin `other`; (d) con ≤ 5 → todas; (e) en todos los casos `sum(categories.seconds) = cards.stopSeconds`; (f) «Sin categoría» pequeña se agrupa en «Otras» como cualquier otra.
- [ ] T024 [P] [US3] Ampliar `tests/indicators-charts.test.tsx` (tras T019): `CategoryDonutCard` muestra «Sin categoría» y «Otras» como etiquetas en la leyenda con horas y porcentaje sin decimales; mensaje «No hay paradas por categoría en este periodo.» si la lista está vacía.

### Implementación US3

- [ ] T025 [US3] Crear `src/components/indicators/CategoryDonutCard.tsx`: título «Paradas por categoría», `PieChart` con `innerRadius` (dona) y `Pie`, colores `var(--chart-1)…var(--chart-5)` para las categorías y `var(--muted-foreground)` para «Otras» (asignación estable por posición); `ChartTooltip` con el nombre, el valor exacto en `formatHours` y el porcentaje; **leyenda en lista debajo/al lado** con nombre, horas y porcentaje para no depender solo del color; rótulos vía `categoryLabel` («Sin categoría», «Otras»); en el centro de la dona el total de horas; mensaje de vacío; legible a 375 px (leyenda en columna).
- [ ] T026 [US3] Integrar `CategoryDonutCard` en `src/components/indicators/IndicatorsDashboard.tsx` (tras T022; mismo archivo): en escritorio junto a las barras, en móvil debajo; esqueleto mientras carga.

**🔒 Revisión US3**: `bun run db:test`, `bun test`, `astro check`, verificación visual de la dona (claro y oscuro). GO/NO-GO de Opus.

---

## Phase 7: Datos de demostración, documentación y cierre

**Propósito**: dejar la demo lista y la evidencia final.

- [ ] T027 [P] Crear `scripts/seed-demo-indicators.sql` (solo local; cabecera con el comando de ejecución igual que `scripts/seed-month.sql` y la advertencia «NUNCA contra producción»). Dentro de `begin; … commit;` y con un bloque `DO` inicial que **aborta** (`raise exception`) si faltan los perfiles semilla (`10000000-0000-0000-0000-000000000001..5`) o existe cualquier máquina distinta de `M-01..M-03`. Genera ~90 días hasta la fecha actual en Bogotá (`(now() at time zone 'America/Bogota')::date`), 3 máquinas × 3 turnos en días hábiles con algunos huecos; mayoría `CLOSED` en lo antiguo y más `SUBMITTED` en lo reciente; tiempos de aprobación que mejoran hacia el presente (≈ 30 h al inicio → ≈ 6 h al final); unos pocos `DRAFT`/`CANCELLED` y paradas abiertas/canceladas (para evidenciar que se excluyen); 8 categorías de parada (crear las que falten con códigos únicos `D1..D8` si `stop_categories` tiene menos de 8 activas, sin tocar las existentes), distribución desigual por categoría y una máquina claramente peor; incluye al menos una parada que cruza la medianoche. Usa `set local session_replication_role = replica`, `production_order` con prefijo `DEMO-`, folios `RPT-2026-2xxxxx` y UUID deterministas; al inicio borra solo sus filas (`production_order like 'DEMO-%'`) para ser repetible. Debe poder ejecutarse con el comando documentado y dejar las tres gráficas con contenido en los rangos 7d, 30d y 90d.
- [ ] T028 Ejecutar T027 contra el Supabase local (`bun run db:reset` y luego el script) y verificar con `psql` local: conteos de reportes/paradas, que el script **falla sin cambios** si se simula entorno distinto (p. ej. tras insertar una máquina `X-99`, hacer rollback y confirmar el aborto), y que `select public.indicators_summary(current_date - 29, current_date)` devuelve datos en las cuatro secciones.
- [ ] T029 [P] Actualizar documentación: `docs/DATA_MODEL.md` (fila de la migración `20261019000100_indicators_summary` en la tabla de orden y descripción de `indicators_summary` y su índice), `docs/API.md` (sección `GET /api/indicadores`, tomando contracts/http-api.md), `docs/TESTING.md` (cómo sembrar la demo y el recorrido manual de «Indicadores»), `docs/SECURITY_AND_ABUSE.md` (fila de permisos: Indicadores para ROOT/ADMINISTRATOR/VIEWER). Sin contraseñas ni datos de producción.
- [ ] T030 Recorrido manual completo de `quickstart.md` §3 con el stack local y la semilla (pasos 1–10), incluyendo capturas/observaciones a **375 px y escritorio, claro y oscuro**: sin desplazamiento horizontal, tooltips con valor exacto al pasar y al tocar, mensajes de vacío con la base sin semilla, error con la red en offline. Anotar resultados en `specs/002-indicators-dashboard/quickstart.md` (sección «Resultados de validación»). Revisar contraste de las 5 series en oscuro; si hace falta ajustar una variable `--chart-N` de `global.css`, **reportarlo a Opus antes de cambiarla**.
- [ ] T031 Verificación final completa y evidencia: `bun test`, `bun run db:test`, `bunx astro check`, `bun run build` en verde (pegar las salidas resumidas en el informe); `explain analyze select * from public.indicators_summary(current_date - 89, current_date);` como dato informativo (R-07); confirmar con `git status` que no hay archivos fuera de los listados en el plan y que `launch.json` no se incluye.

**🔒 Revisión final (GO/NO-GO de Opus)**: revisar el diff completo contra spec/plan y el Constitution Check (I–V), confirmar que la migración **no** se aplicó a producción y que la semilla tiene sus guardas.

---

## Dependencias y orden de ejecución

```text
Phase 1 (T001) ─┬─> Phase 2: T002 ─> T004
                │            T003 ─┘ (T003 en paralelo con T002)
                └─> Phase 3 US1 ─> Phase 4 US4 ─> Phase 5 US2 ─> Phase 6 US3 ─> Phase 7
```

- **Setup → Foundational → US1** son estrictamente secuenciales; **US4** puede empezar tras Foundational (sus pruebas T012–T015 no necesitan la UI) y debe estar listo **antes de la demo**.
- **US2 y US3** dependen de Foundational y de la isla (T010); sus componentes de gráfica (T020, T021, T025) son archivos distintos y se pueden construir en paralelo, pero la integración en `IndicatorsDashboard.tsx` (T022, T026) es secuencial.
- `supabase/tests/indicators_summary.test.sql` se amplía en T005 → T015 → T018 → T023 (mismo archivo: sin paralelismo entre estas).
- `tests/indicators-api.test.ts`: T007 → T012. `tests/indicators-charts.test.tsx`: T019 → T024.
- T027 (semilla) solo depende de T002; puede hacerse en paralelo con las fases 3–6 y es necesaria para verificar visualmente US2/US3.

### Oportunidades de paralelismo

- Tras T002: T003 en paralelo.
- US1: T006, T007, T008 en paralelo entre sí (archivos distintos) mientras T009 avanza; T005 corre aparte (SQL).
- US4: T012–T014 en paralelo (archivos distintos), T016–T017 en paralelo entre sí.
- US2/US3: T019, T020, T021 en paralelo; T024 y T025 en paralelo.
- T027 y T029 en paralelo con cualquier fase posterior a Foundational.

## Estrategia de implementación

1. **MVP para la demo**: Phase 1 → 2 → 3 (tarjetas + filtro) → 4 (acceso). Con esto ya se puede mostrar el número del piloto (tiempo de aprobación) con seguridad correcta.
2. Añadir **US2** (área y barras), luego **US3** (dona); cada una se valida de forma independiente.
3. Semilla y documentación (T027–T029) en paralelo; verificación final (T030–T031) al cierre.
4. Si el tiempo apremia, el orden de recorte es: T029 (docs) → T024/T019 (pruebas de gráficas, se cubren con verificación manual) → US3. **Nunca** se recortan T005/T015/T018/T023 (pgTAP), T012/T013 (acceso) ni T016 (middleware).

## Resumen

| Fase | Tareas | Historia |
|---|---|---|
| 1 Setup | T001 | — |
| 2 Foundational | T002–T004 | — |
| 3 US1 (P1) | T005–T011 | US1 |
| 4 US4 (P1) | T012–T017 | US4 |
| 5 US2 (P2) | T018–T022 | US2 |
| 6 US3 (P3) | T023–T026 | US3 |
| 7 Demo y cierre | T027–T031 | — |

Total: 31 tareas.
