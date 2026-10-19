# Data Model: Tablero de Indicadores de Producción

La feature **no crea tablas ni columnas**. Lee las existentes (ver `docs/DATA_MODEL.md`) y agrega una función de lectura y un índice.

## Tablas leídas

| Tabla | Columnas usadas | Uso |
|---|---|---|
| `production_reports` | `id`, `report_date`, `status`, `machine_id`, `shift_id`, `approved_at` | Conjunto de reportes (`SUBMITTED`, `CLOSED`), día operativo, máquina, aprobación |
| `report_stop_events` | `report_id`, `stop_category_id`, `ended_at`, `cancelled_at`, `duration_seconds` | Horas de parada: solo cerradas y no canceladas |
| `machines` | `id`, `code`, `name` | Etiqueta de la gráfica por máquina |
| `stop_categories` | `id`, `name` | Etiqueta de la gráfica por categoría |
| `shifts` | `id`, `start_time`, `end_time` | Fin de turno para el tiempo hasta aprobación |

## Reglas de selección (resumen; detalle en research R-03/R-04)

- **Reporte contado**: `status in ('SUBMITTED','CLOSED')` y `report_date between p_from and p_to`.
- **Parada contada**: pertenece a un reporte contado, `ended_at is not null`, `cancelled_at is null`, `duration_seconds is not null`; aporta `duration_seconds` completos a la fecha `report_date` de su reporte.
- **Aprobado**: `status = 'CLOSED'` (con `approved_at` no nulo por el CHECK `production_reports_approval_consistency`).
- **Fin de turno**: `(report_date + shifts.end_time) at time zone 'America/Bogota'`, más 1 día si `end_time <= start_time`.
- **Tiempo hasta aprobación** por reporte: `greatest(approved_at − fin_de_turno, 0)`; promedio solo sobre `CLOSED` con turno resoluble.

## Objetos nuevos

### Función `public.indicators_summary(p_from date, p_to date) returns jsonb`

`security invoker`, `stable`, `set search_path = ''`. Permisos: `revoke all … from public, anon`; `grant execute … to authenticated`. Errores: `42501` si el llamador no es manager ni `VIEWER`; `22023` si `p_from > p_to` o el rango supera 366 días. Forma del JSON: ver [contracts/http-api.md](contracts/http-api.md).

### Índice

`production_reports_report_date_status_idx on public.production_reports (report_date, status)`.

### Migración

`supabase/migrations/20261019000100_indicators_summary.sql` — sigue en orden de nombre a la última existente (`20261018000100_machine_location`). Sin `ALTER TYPE`. Reproducible con `bun run db:reset`. **No se aplica a producción** (DEPLOYMENT: ensayo solo con el stack local; la aplicación a producción es una decisión posterior y explícita del responsable).

## Entidades derivadas (solo en la respuesta, no se persisten)

- **Tarjetas del periodo**: conteo de reportes, aprobados, razón de aprobados, promedio de segundos hasta aprobación, segundos totales de parada.
- **Punto diario**: `{ date, seconds }`, uno por cada día del rango.
- **Máquina agregada**: `{ machineId, code, name, seconds }`, máximo 10.
- **Segmento de categoría**: `{ kind: category | uncategorized | other, categoryId, name, seconds }`, máximo 6.

## Transiciones de estado

Ninguna: feature de solo lectura.
