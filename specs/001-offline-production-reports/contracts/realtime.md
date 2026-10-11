# Contrato de tiempo real (Fase 5)

Diseño en [research.md](../research.md) R11. Objetivo: SC-005 (< 10 s con conexión).

## Cliente

`src/lib/supabase/browser.ts` **[NUEVO]**: `createBrowserClient(PUBLIC_SUPABASE_URL,
PUBLIC_SUPABASE_PUBLISHABLE_KEY)` reutilizando las cookies de sesión de `@supabase/ssr`. Un único
cliente por pestaña; se desconecta en logout.

## Canales `postgres_changes`

Publicación `supabase_realtime` **[NUEVO en migración F5]**: `production_reports`,
`report_stop_events`, `report_change_events`, `report_audit_log`, `sync_quarantine`. La RLS de cada
tabla filtra lo que recibe cada suscriptor (el operario solo recibe lo suyo; el auditor, todo en
solo lectura).

| Vista | Suscripción | Acción al recibir |
| --- | --- | --- |
| Tablero (`/dashboard`) — manager, auditor | `production_reports` `*`, `report_stop_events` `*`, `sync_quarantine` `*` | Re-pedir `GET /api/dashboard/summary` (debounce 500 ms) y la fila afectada. |
| Lista (`/reportes`) — manager, auditor | `production_reports` `*` | Si la fila cumple los filtros activos, re-pedir la página actual (debounce 1 s). |
| Detalle (`/reportes/[id]`) — manager, auditor | filtro `report_id=eq.<id>` en paradas, cambios y `report_audit_log`; `id=eq.<id>` en reportes | Re-pedir `GET /api/reports/[id]/timeline`. |

El payload del evento **no** se renderiza directamente (puede estar incompleto); solo dispara la
recarga del fragmento autorizado.

## Presencia `plant-presence`

- Solo operarios publican: `track({ userId, fullName, pendingCount, lastSeen })` (payload mínimo; la máquina y el reporte
  se obtienen del servidor), actualizado al cambiar `pendingCount` y cada 30 s.
- Managers y auditores solo escuchan (`presence sync`) y muestran: "En línea" (presente), "En
  línea con pendientes" (`pendingCount > 0`) y "Sin conexión" (no presente; con "última vez" si se
  conoce). La plataforma no conoce el estado de un dispositivo offline hasta que reconecta (supuesto
  de la spec).
- Autorización del canal: canal privado con políticas sobre `realtime.messages` que permiten
  `track` solo a `OPERATOR` y lectura a manager/VIEWER.

## Respaldo

Si la suscripción no alcanza `SUBSCRIBED` en 5 s o pasa a `CHANNEL_ERROR`/`TIMED_OUT`: polling cada
8 s de los mismos endpoints hasta reconectar. Indicador discreto "Actualización automática cada
8 s".
