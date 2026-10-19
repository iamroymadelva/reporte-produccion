# Quickstart: validación de Indicadores

> Todo en el stack **local**. `.env.local` apunta a producción: no lo uses. `bun run dev` fuerza Supabase local. No se aplica ninguna migración a producción.

## 1. Preparar

```sh
bun install                 # incluye recharts
bun run db:start
bun run db:reset            # migraciones (incluye 20261019000100) + supabase/seed.sql
docker exec -i supabase_db_reporte-produccion psql -U postgres -v ON_ERROR_STOP=1 < scripts/seed-demo-indicators.sql
bun run dev                 # http://localhost:4321 (al terminar: bunx astro dev stop)
```

La semilla de demo solo corre con los usuarios/máquinas sembrados localmente y aborta si no los encuentra. Se deshace con `bun run db:reset`.

## 2. Verificaciones automáticas (evidencia para el GO)

```sh
bun test
bun run db:test
bunx astro check
bun run build
```

## 3. Recorrido manual (demo)

Contraseña de todos: `Planta2026!`.

| # | Usuario | Acción | Resultado esperado |
|---|---|---|---|
| 1 | `coord1` | Entrar → menú «Indicadores» | Filtro en «Últimos 30 días»; 4 tarjetas con valores; área, barras (≤ 10) y dona con datos |
| 2 | `coord1` | Cambiar a «Últimos 7 días» y «Últimos 3 meses» | Todo se recalcula; el eje del área cubre 7 / 90 días; sin mezcla de rangos |
| 3 | `auditor1`, `root` | Abrir «Indicadores» | Mismos tableros (los datos que su RLS permite) |
| 4 | `op1` | Mirar el menú; abrir `/indicadores` y `/api/indicadores?rango=30d` | Sin ítem; redirección a `/reportes`; API 403 |
| 5 | `coord1` | `/api/indicadores?rango=15d` (y sin `rango`) | 422 |
| 6 | cualquiera | Pasar el cursor / tocar puntos, barras y segmentos | Tooltip con valor exacto en horas (`12,5 h`) |
| 7 | `coord1` | Con la semilla: comprobar dona | Máximo 6 segmentos; «Otras» presente; sin «Sin categoría» (la semilla no la genera) |
| 8 | `coord1` | Borrar la semilla (`db:reset` sin sembrar) y abrir Indicadores | Cada gráfica con mensaje de «sin datos»; tarjetas en 0 y «—» |
| 9 | `coord1` | DevTools a 375 px, claro y oscuro | Sin desplazamiento horizontal; etiquetas legibles; colores correctos en ambos modos |
| 10 | `coord1` | DevTools → Network → Offline y cambiar rango | Mensaje de error en español con botón «Reintentar» |

## 4. Cuadre numérico de la demo

Con la semilla, contrastar una tarjeta con SQL directo (psql local):

```sql
select count(*) filter (where status in ('SUBMITTED','CLOSED')) as reportes,
       count(*) filter (where status = 'CLOSED')                 as aprobados
from public.production_reports
where report_date between current_date - 29 and current_date;   -- ajustar a la fecha Bogotá
```

Las horas de parada = `sum(duration_seconds)/3600` de las paradas cerradas y no canceladas de esos reportes.

## 5. Índice (informativo)

```sql
explain analyze select * from public.indicators_summary(current_date - 89, current_date);
```
