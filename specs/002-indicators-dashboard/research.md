# Research: Tablero de Indicadores de Producción

Estado del repo verificado el 2026-10-19 (rama `002-indicators-dashboard`). Documentos leídos: `docs/ARCHITECTURE.md`, `docs/DATA_MODEL.md`, `docs/DEPLOYMENT.md`, `docs/TESTING.md`, constitución v1.0.0.

## R-01 — Gráficas: shadcn/ui + Recharts

- **Hallazgo**: el proyecto ya usa Tailwind 4 y shadcn/ui (`components.json`, estilo `new-york`, `cssVariables: true`; existen `Card`, `Select`, `Skeleton`, `Alert`, etc. en `src/components/ui/`). `src/styles/global.css` ya define `--chart-1…--chart-5` para claro y oscuro. **No** hay `recharts` ni `ui/chart.tsx`.
- **Decisión**: agregar `recharts` y `src/components/ui/chart.tsx` (`ChartContainer`, `ChartTooltip`, `ChartTooltipContent`, `ChartLegend`) con la CLI de shadcn o copiando el componente oficial; usar las variables `--chart-N` existentes para las series. **No** se cambia ningún otro componente ni el tema. No hace falta "integración mínima" de Tailwind/shadcn: ya existen.
- **Versión**: la compatibilidad de `recharts` con React 19 depende de la versión (la 3.x la soporta; la 2.x requería un override de `react-is`). El ejecutor fija la versión que instale la CLI de shadcn y confirma que `bun run build` y `astro check` pasan; si hay conflicto de `react-is`, resolverlo con `overrides` en `package.json` y anotarlo.
- **Impacto en bundle**: la isla vive solo en `/indicadores` (`client:load` en esa página); `public/sw.js` solo precachea los tres shells offline, así que no hay efecto en el service worker ni en `CACHE_VERSION`.
- **Alternativas descartadas**: (a) SVG propio — más trabajo y riesgo para una demo en un día; (b) Chart.js/ECharts — no encajan con los componentes shadcn pedidos; (c) cualquier servicio externo — innecesario.
- **Accesibilidad**: la dona usa 6 colores; para no depender solo del color cada gráfica muestra etiquetas/leyenda con valor y porcentaje, y el tooltip da el valor exacto (FR-015). «Otras» usa un neutro (`--muted-foreground`), no un color de serie.

## R-02 — Función SQL única, `security invoker`

- **Decisión**: `public.indicators_summary(p_from date, p_to date) returns jsonb`, `language plpgsql stable security invoker set search_path = ''`. `revoke all … from public, anon; grant execute … to authenticated`.
- **Autorización en la función** (Principio I): si no es `private.is_manager()` ni `private.current_user_role() = 'VIEWER'` → `raise exception … using errcode = '42501'`. Así un operario no obtiene datos ni siquiera llamando a PostgREST directo (su RLS le mostraría sus propios reportes; la función lo rechaza antes). `is_manager()` y `current_user_role()` ya tienen `execute` para `authenticated`.
- **Validación**: `p_from <= p_to` y máximo 366 días (mismo tope que `/api/dashboard/summary`); si no, `22023`.
- **RLS**: al ser `security invoker`, todo lo que lea (`production_reports`, `report_stop_events`, `machines`, `stop_categories`, `shifts`) pasa por las políticas del llamador, cumpliendo FR-014 (permisos actuales). Hoy managers y VIEWER leen todos los reportes (`reports_select_by_role`); si esa política cambia, el tablero la sigue sin tocar código.
- **Alternativas descartadas**: `security definer` (saltaría RLS, contradice FR-014 y el pedido del usuario); varias consultas PostgREST desde el endpoint (más viajes, agregación en TypeScript, más superficie de error; el patrón de `/api/dashboard/summary` hace 11 consultas, no lo repetimos).
- **Forma de salida**: todo en **segundos** y razones (0–1); la conversión a horas y el redondeo a 1 decimal ocurren una sola vez en `src/lib/indicators.ts` (evita que sumas de valores ya redondeados no cuadren con el total). Ver `contracts/http-api.md`.

## R-03 — Qué cuenta y a qué fecha (Clarifications + pedido)

- **Reportes**: `status in ('SUBMITTED','CLOSED')` y `report_date between p_from and p_to`. `DRAFT` y `CANCELLED` fuera de tarjetas y gráficas (Clarifications 2 y 3).
- **Paradas**: de esos reportes, `ended_at is not null and cancelled_at is null and duration_seconds is not null`; suman `duration_seconds` (autoritativa; el trigger la calcula como `floor(epoch(ended_at − started_at))`). Una parada abierta o cancelada aporta 0 (CHECK existente: la cancelada tiene `duration_seconds` NULL). Cada parada cuenta completa en el `report_date` de su reporte (Clarification 1).
- **Día**: `report_date` ya es la fecha operativa en Bogotá (la calcula la base con `private.current_shift_at`); la función no convierte husos para agrupar. La serie usa `generate_series(p_from, p_to, '1 day')` con `left join`, de modo que los días sin paradas salen en 0 desde el servidor.
- **Máquinas**: agrupa por `machine_id` del reporte, orden `seconds desc, code asc` (desempate estable), `limit 10`, solo máquinas con segundos > 0.
- **Categorías**: agrupa por `stop_category_id`. `NULL` → `kind = 'uncategorized'` (el UI lo rotula «Sin categoría»; hoy el flujo exige categoría para cerrar, pero la columna admite NULL y la spec lo pide). Si hay **más de 6** grupos con segundos > 0, se devuelven los **5** mayores + un grupo `kind = 'other'` («Otras») con la suma del resto → 6 segmentos como máximo, suma = total (FR-010). Con ≤ 6 se devuelven todos. «Sin categoría» compite como cualquier otro grupo. El rótulo en español lo pone la UI (la función devuelve `kind`, no texto de interfaz).

## R-04 — Tiempo hasta aprobación (decisión no especificada)

- **Fórmula pedida**: `approved_at − fin de turno`, solo `CLOSED`, fin de turno = fecha operativa + `shifts.end_time` en America/Bogota.
- **Turno que cruza la medianoche**: un turno nocturno (p. ej. 22:00–06:00) pertenece al día en que empieza (ARCHITECTURE), así que su fin cae en `report_date + 1`. **Decisión**: `shift_end = (report_date + end_time) at time zone 'America/Bogota' + (case when end_time <= start_time then interval '1 day' else interval '0' end)`. Sin esto el promedio saldría negativo o inflado para el turno de noche. Los turnos 24 h (`end_time = start_time`) se tratan como cruce de día.
- **Aprobado antes del fin del turno** (posible si se envía y aprueba antes): se acota a 0 con `greatest(…, 0)`; no se descartan para no sesgar el promedio hacia arriba. Se documenta en quickstart y se prueba.
- **Sin turno** (`shift_id` NULL o turno sin fila legible): ese reporte no entra al promedio (no hay fin de turno que medir) pero sí al conteo y al % de aprobados.
- **Sin aprobados**: `avgApprovalSeconds = null`; la UI muestra «—» (edge case de la spec). El promedio se calcula sobre `CLOSED` del periodo (por `report_date`), no por fecha de aprobación.
- **Porcentaje**: `approvedRatio = closed / (submitted + closed)`; `null` si no hay reportes (la UI muestra «—», no 0 %, para no sugerir "0 % aprobado" sin datos; la spec pedía 0 % si hay reportes pero ninguno aprobado, y eso sí se devuelve como 0).

## R-05 — Rango de fechas

- `7d`, `30d`, `90d` → 7, 30 y 90 días de fecha operativa que terminan **hoy incluido**: `to = hoy en Bogotá`, `from = to − (n − 1)`. «Hoy» se calcula en el servidor con `getBogotaDateKey()` (ya existe en `src/lib/format.ts`), nunca con el reloj del navegador. La resta de días se hace sobre el calendario (`Date.UTC` del mediodía, como hace `dashboard/summary.ts`), sin depender de la zona del servidor.
- Rótulos UI: «Últimos 7 días», «Últimos 30 días» (defecto), «Últimos 3 meses».
- `rango` ausente o con otro valor → `422` (el UI siempre lo envía).

## R-06 — Endpoint y control de acceso

- Convención del repo: ruta en `src/pages/api/<nombre>.ts` que exporta `GET: APIRoute`, usa `locals.auth` (puesto por el middleware), `json()` de `src/lib/http.ts` y `Cache-Control: private, no-store`. Códigos: 401 sin sesión, 403 rol no permitido, 422 `rango` inválido, 500 error de base de datos (mensaje genérico en español; el detalle solo a `console.error`).
- Se re-valida el rol en la ruta aunque el middleware ya filtre (Principio I), igual que `dashboard/summary.ts`.
- **Middleware**: nueva rama `inSection(pathname, "/indicadores") || inSection(pathname, "/api/indicadores")` → `deny` si no es manager ni `VIEWER`. En páginas `deny` redirige a `/reportes` (comportamiento existente).
- El endpoint pasa `p_from`/`p_to` calculados en servidor; el cliente no puede elegir fechas arbitrarias (menos superficie que `dashboard/summary`).

## R-07 — Índice por fecha operativa

- **Hallazgo**: no existe índice sobre `production_reports(report_date)` (solo `created_by,status` y `cancelled_by,cancelled_at`); `report_stop_events` ya tiene `(report_id, started_at)` para el join.
- **Decisión**: `create index production_reports_report_date_status_idx on public.production_reports (report_date, status);` en la misma migración. Costo bajo en escritura, beneficia también a `/api/dashboard/summary` y al listado, que filtran por `report_date`. Con el volumen del piloto el planificador puede preferir un recorrido secuencial; el índice no daña y evita degradación al crecer. Verificación: `EXPLAIN` sobre la semilla de demo (quickstart) — informativo, no criterio de aceptación.
- **Descartado**: índice parcial por estado y índice sobre `report_stop_events` (ya cubierto); más índices sería sobreoptimizar.

## R-08 — Formato (es-CO)

- Horas con **1 decimal** (`12,5 h`) y porcentajes **sin decimales** (`85 %` en `es-CO` con `Intl.NumberFormat`; el prompt escribe «85%», se acepta el espacio que produce `Intl` salvo que el usuario pida lo contrario). Se añaden helpers propios en `src/lib/indicators.ts` (`formatHours`, `formatRatioPercent`) en lugar de modificar `formatPercent`/`formatNumber` (que otras pantallas usan con 1–2 decimales).
- Fechas del eje X: `formatDate`-style en `America/Bogota`, corto (`9 oct`); el tooltip muestra la fecha completa. El `report_date` llega como `AAAA-MM-DD` y se formatea a mediodía UTC (patrón existente) para no desplazar el día.

## R-09 — Isla React y estados

- Una isla `IndicatorsDashboard` montada con `client:load` en `indicadores.astro`. Estado: `range` (defecto `30d`), `status` (`loading | ready | error`), `data`. Cada cambio de rango aborta la petición anterior (`AbortController`) para no mezclar rangos (edge case de la spec), muestra esqueletos y reintenta con botón en error (FR-019).
- Selector: `Select` de shadcn arriba a la derecha de la página (ancho completo en móvil). Se desvía levemente del patrón «Area Chart – Interactive», cuyo selector vive dentro de la tarjeta del área, porque aquí el filtro gobierna toda la página (FR-003). La tarjeta del área conserva su encabezado con título y descripción del rango.
- Vacíos (FR-016): si `daily` suma 0 → mensaje «Sin paradas en este periodo» en las tres gráficas (cada una con su propio texto: «No hay paradas registradas en este periodo»…); las tarjetas muestran 0 / «—».
- Responsivo: `ChartContainer` con `aspect-video`/altura fija en móvil; barras horizontales con etiquetas de máquina truncadas y `tooltip` con nombre completo; sin `min-width` que fuerce scroll horizontal a 375 px.
- Tema: colores solo con `var(--chart-N)` y tokens (`--muted-foreground`); no se introducen colores nuevos. Verificar contraste de las 5 series en oscuro (valores ya definidos en `.dark`).

## R-10 — Semilla de demo (solo local)

- **Hallazgo**: existe `scripts/seed-month.sql` (900 reportes para medir exportación SC-006), con el patrón `set local session_replication_role = replica` para insertar sin disparar triggers; usa los usuarios y máquinas de `supabase/seed.sql` (UUID `10000000-…`, `30000000-…`). No sirve para la demo (un mes, patrones uniformes, sin variación por categoría ni aprobaciones realistas).
- **Decisión**: nuevo `scripts/seed-demo-indicators.sql`, ejecutado a mano contra el contenedor local (mismo comando que `seed-month.sql`), **no** vía `supabase/seed.sql` (correría en cada `db:reset` y ensuciaría las pruebas pgTAP).
- **Guardas** (el script aborta si fallan, dentro de un bloque `DO` antes de insertar): (1) deben existir los perfiles semilla locales (`10000000-…-0001` a `…-0005`) con el username esperado — la producción no tiene usuarios sembrados (DEPLOYMENT); (2) la base debe llamarse `postgres` y no existir ninguna máquina fuera de las 3 sembradas (`M-01..M-03`) — un entorno real tendría otras; (3) un comentario de cabecera y `begin; … commit;` con `ON_ERROR_STOP`. Es defensa en profundidad: la regla principal sigue siendo «solo se ejecuta con el stack local» (`bun run dev` ya fuerza URLs locales).
- **Contenido**: ~90 días hasta hoy (relativo a `current_date` en Bogotá, para que los tres rangos tengan contenido), 3 máquinas × 3 turnos (días hábiles; algunos huecos), mezcla de `SUBMITTED` (≈ 30 % los más recientes) y `CLOSED`, un puñado de `DRAFT`/`CANCELLED` y de paradas abiertas/canceladas **para evidenciar que se excluyen**, 8 categorías de parada (para ver «Otras»), tiempos de aprobación que mejoran hacia el presente (historia del piloto), una máquina claramente peor que las otras. Sin categorías NULL (no es un estado realista del flujo); «Sin categoría» queda cubierto por pgTAP.
- Idempotencia: folios `RPT-2026-2xxxxx` y UUID deterministas; el script borra primero solo sus propias filas (marcadas con un prefijo de `production_order` `DEMO-`) para poder repetirse.
- Se revierte con `bun run db:reset`.

## R-11 — Pruebas

- **pgTAP** (`supabase/tests/indicators_summary.test.sql`), con `tests.auth_as_role` del helper: (a) excluye `DRAFT` y `CANCELLED`; (b) excluye paradas abiertas y canceladas; (c) agrupa por `report_date` y la serie incluye días con 0; (d) parada que cruza la medianoche cuenta completa en el día de su reporte; (e) operario → `42501` y anónimo sin ejecución; (f) ROOT, ADMINISTRATOR y VIEWER obtienen datos; (g) `Sin categoría` y `Otras` (> 6 categorías, suma = total); (h) máximo 10 máquinas, orden descendente; (i) promedio de aprobación con turno nocturno y aprobación anterior al fin de turno; (j) rango inválido → `22023`; (k) RLS: se prueba que la función no es `security definer` (`prosecdef = false`).
- **bun test**: `tests/indicators-api.test.ts` (mock de `createSupabaseServerClient` como en `dashboard-summary-api.test.ts`): 401, 403 operario (sin consultar la base), 422 `rango` ausente/`15d`/`30D`/vacío, 200 para los tres roles con fechas esperadas por rango, 500 con error de RPC, cabecera `no-store`. `tests/indicators-lib.test.ts`: rangos, formateo es-CO (`12,5 h`, `85 %`). `tests/indicators-dashboard.test.tsx` (happy-dom): estados cargando/vacío/error y cambio de rango con `fetch` simulado; las gráficas de Recharts no se miden en happy-dom (sin layout), así que la prueba de la isla cubre tarjetas, vacíos, error y selector; el dibujo real de las gráficas se verifica a mano en el quickstart.
- `tests/ui-shell.test.tsx` y `tests/role-access.test.ts`: ampliar si ya enumeran ítems de navegación o rutas protegidas (el ejecutor lo confirma).
