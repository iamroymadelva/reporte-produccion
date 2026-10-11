# Implementation Plan: Plataforma de reportes de producción con operación offline y roles separados

**Branch**: `redesign/ui-ux` (sin rama dedicada) | **Fecha**: 2026-10-09 | **Spec**: [spec.md](./spec.md)
**Entrada**: spec con Clarifications 2026-10-09 (10 decisiones) + [gap-analysis.md](./gap-analysis.md)
como línea base del estado actual.

## Summary

La plataforma (Astro 7 SSR + Supabase) ya cubre reportes, paradas, catálogos, Excel y parte de la
auditoría, pero le faltan cinco bloques. Este plan los cierra en **5 fases**, en el orden pedido:

1. **Base de datos**: roles con ROOT, estado `CLOSED`, asignaciones por turno, fecha operativa,
   entidad "Cambio", horas del dispositivo, columnas de auditoría y sincronización, RLS objetivo.
2. **Roles y aprobación**: login por usuario con bloqueo, matriz raíz/coordinador, aprobación,
   reglas de cancelación y de edición, catálogos.
3. **Auditoría**: historial completo con motivo, rol e indicador offline; auditor con visibilidad
   total; historial administrativo solo para ROOT; filtros completos y Excel con CAMBIOS/HISTORIAL.
4. **Offline completo**: 4a, turno completo del operario con outbox idempotente y confirmación; 4b,
   login offline y consulta offline.
5. **Tiempo real**: Supabase Realtime + Presence con polling de respaldo.

El enfoque técnico mantiene Supabase como autoridad (RLS y triggers aplican las reglas también para
lo que llega offline). El modo offline se resuelve con un **shell prerenderizado sin datos +
IndexedDB por usuario + RPC idempotente por operación**. El tiempo real usa **Realtime
`postgres_changes` filtrado por RLS**. Detalle en [research.md](./research.md).

## Technical Context

**Language/Version**: TypeScript 5.9 (Astro 7, React 19); SQL/PLpgSQL (PostgreSQL de Supabase)
**Primary Dependencies**: Astro 7 + `@astrojs/vercel`, React 19 (islas), `@supabase/ssr` 0.12 /
`@supabase/supabase-js` 2.x (Auth, PostgREST, **Realtime**), ExcelJS 4, Tailwind 4 + shadcn/Radix.
Sin dependencias nuevas de runtime: WebCrypto (PBKDF2) e IndexedDB nativos.
**Storage**: PostgreSQL (Supabase) con RLS; IndexedDB en el cliente (`reporte-produccion-offline` v2);
Cache Storage solo para assets y shells sin datos.
**Testing**: `bun test` (happy-dom, fake-indexeddb); pgTAP vía `supabase test db`; `astro check`;
`astro build`.
**Target Platform**: Vercel serverless (SSR) + navegadores modernos en tabletas/teléfonos de planta
(Chrome/Edge Android, Safari iOS ≥ 16), instalables como PWA.
**Project Type**: aplicación web full-stack monorepo (Astro SSR + islas React + base de datos
Supabase).
**Performance Goals**: realtime < 10 s (SC-005); Excel de un mes < 30 s (SC-006); login offline
< 15 s (SC-012); iniciar reporte < 30 s y parada < 20 s (SC-001/002).
**Constraints**: offline-first para el operario durante un turno de hasta 12 h; **0 subidas sin
confirmación** (SC-004); nunca cachear HTML ni datos autenticados en Cache Storage; UI en español
`es-CO`, zona `America/Bogota`; RLS como barrera final (FR-003).
**Scale/Scope**: una planta, del orden de decenas de máquinas y ≤ 200 usuarios; volumen esperado
de decenas a cientos de reportes al día (hay una prueba existente con > 1000 reportes,
`supabase/tests/report_pagination_large.test.sql`); 4 roles y unas 15 pantallas.

Sin `NEEDS CLARIFICATION` pendientes: todas las incógnitas se resolvieron en research.md (R1–R14).

## Constitution Check

*GATE: debe pasar antes de Fase 0 y re-verificarse tras el diseño.*

Evaluado contra `.specify/memory/constitution.md` **v1.0.0** (ratificada 2026-10-09).

| Principio / sección | Estado pre-diseño | Estado post-diseño |
| --- | --- | --- |
| I. Autorización en el servidor | ✅ | ✅ RLS objetivo por rol (data-model); la sync pasa por RPC con RLS (R9); `service_role` solo para Auth Admin y lockout (R1/R2) |
| II. Trazabilidad e integridad | ⚠️ La auditoría actual es parcial y hay DELETE de paradas | ✅ Auditoría total con motivo, rol y offline (R7); sin DELETE de paradas; hora del dispositivo + llegada (R6) |
| III. Offline seguro con confirmación | ⚠️ El offline completo necesita UI sin red; hoy hay subida implícita | ✅ Shells prerenderizados **sin datos** + IndexedDB por usuario (R10); outbox idempotente, sin autosave con pendientes (R9); verificador PBKDF2 (R8) |
| IV. Pruebas como evidencia | ✅ | ✅ pgTAP + bun test por fase; puertas en quickstart.md (R14) |
| V. Simplicidad sobre el stack | ✅ | ✅ Sin dependencias de runtime nuevas; `ADD VALUE` en migraciones separadas; se descartan CRDT y servicios externos (R9) |
| Restricciones de plataforma | ✅ | ✅ Realtime vía Supabase, no conexiones largas en Vercel (R11); es-CO / Bogotá / fecha operativa |
| Flujo de desarrollo | ✅ | ✅ Una puerta GO por fase; `executor` implementa, Opus revisa |

**Resultado**: PASA. Los ⚠️ previos al diseño los resuelve el propio diseño; no hay violaciones que
justificar (Complexity Tracking vacío).

## Project Structure

### Documentation (this feature)

```text
specs/001-offline-production-reports/
├── spec.md               # Spec + Clarifications 2026-10-09
├── gap-analysis.md       # Línea base (estado actual vs spec)
├── plan.md               # Este archivo
├── research.md           # Fase 0: decisiones R1–R14
├── data-model.md         # Fase 1: modelo objetivo, estados, matriz RLS
├── quickstart.md         # Fase 1: validación manual por fase
├── contracts/
│   ├── http-api.md       # Rutas Astro (nuevas, cambiadas, eliminadas)
│   ├── sync-protocol.md  # Outbox, resumen, /api/sync/batch, garantías
│   ├── database-rpc.md   # RPC, vistas y triggers
│   └── realtime.md       # Canales, presencia, respaldo
├── checklists/
└── tasks.md              # Fase 2: lo genera /speckit-tasks (no este comando)
```

### Source Code (repository root)

```text
supabase/
├── migrations/
│   ├── 2026101000xxxx_app_role_root.sql              # F1: ADD VALUE 'ROOT' (migración propia)
│   ├── 2026101000xxxx_report_status_closed.sql       # F1: ADD VALUE 'CLOSED' (migración propia)
│   ├── 2026101001xxxx_roles_shifts_changes_sync.sql  # F1: esquema, helpers, RLS objetivo
│   ├── 2026101002xxxx_auth_lockout_users.sql         # F2: username, lockout, matriz de gestión
│   ├── 2026101002xxxx_approval_cancellation.sql      # F2: approve/cancel/delete_or_deactivate
│   ├── 2026101003xxxx_full_audit.sql                 # F3: triggers de auditoría, correct_report
│   ├── 2026101004xxxx_offline_sync.sql               # F4a: apply_sync_operation, quarantine
│   └── 2026101005xxxx_realtime_publication.sql       # F5: publicación + políticas de canal
├── seed.sql                                          # F1: ROOT + cuentas de desarrollo
└── tests/*.test.sql                                  # pgTAP nuevas por fase

src/
├── middleware.ts                       # F2: rutas por rol (ROOT/manager/viewer/operator)
├── lib/
│   ├── auth.ts, types.ts               # F2: roles y etiquetas nuevas, isManager/isRoot
│   ├── report-filters.ts               # F3: rango libre + máquina/turno/operario/estado
│   ├── report-export.ts                # F3: hojas CAMBIOS, HISTORIAL, aprobación
│   ├── report-audit.ts                 # F3: actor_role, reason, offline, orden ascendente
│   ├── shifts.ts                       # F1/F4a: turno vigente y fecha operativa (cliente, espejo de la BD)
│   ├── offline/
│   │   ├── db.ts                       # F4a: IndexedDB v2 (outbox, entities, snapshot) + migración v1
│   │   ├── outbox.ts                   # F4a: operaciones tipadas, seq, estados
│   │   ├── sync-client.ts              # F4a: resumen, confirmar/posponer, batch, parcial
│   │   ├── validation.ts               # F4a: solapamientos y obligatorios offline
│   │   └── offline-auth.ts             # F4b: verificador PBKDF2, bloqueo local, enabledUntil
│   ├── offline-report-store.ts         # F4a: se migra a lib/offline/*
│   ├── connectivity.ts                 # F4a: contador de pendientes global
│   └── supabase/browser.ts             # F5: cliente Realtime
├── pages/
│   ├── iniciar-sesion.astro            # F2: username; F4b: modo offline
│   ├── turno.astro                     # F4a: shell prerender (operario)
│   ├── consulta-offline.astro          # F4b: shell prerender (manager/auditor)
│   ├── administracion/historial.astro  # F3: solo ROOT
│   ├── administracion/tipos-cambio.astro # F2
│   └── api/
│       ├── admin/users/index.ts        # F2: alta con contraseña (sustituye invite.ts)
│       ├── reports/[id]/{approve,correct,changes}.ts  # F2/F3/F4a
│       ├── sync/batch.ts               # F4a
│       ├── offline/{snapshot,overview}.ts            # F4a/F4b
│       ├── dashboard/summary.ts        # F5
│       └── admin/audit.ts              # F3
└── components/
    ├── offline/OperatorShiftApp.tsx    # F4a: isla del turno (reporte, paradas, cambios)
    ├── offline/PendingSyncSummary.tsx  # F4a: resumen + confirmar/posponer
    ├── offline/OfflineIndicator.tsx    # F4a: conexión + nº pendientes (global)
    ├── ApprovalPanel.tsx, CorrectionDialog.tsx       # F2/F3
    └── realtime/{LiveDashboard,LiveTimeline,PresenceList}.tsx  # F5

public/sw.js                            # F4a: precache de shells, respaldo de navegación por rol

tests/                                  # bun test: unit + integración por fase
```

**Structure Decision**: Se mantiene el monorepo Astro actual (SSR + islas React + `supabase/`). No
se crean proyectos nuevos. El código offline se agrupa en `src/lib/offline/` y
`src/components/offline/`; el tiempo real, en `src/components/realtime/`.

## Plan por fases

Cada fase se ejecuta según el flujo del `CLAUDE.md`: el plan de la fase pasa al `executor`
(Sonnet), los pasos independientes van en paralelo, luego hay revisión del diff y puertas de
calidad, y la fase se cierra con **GO** del auditor (Opus). Las dependencias son F1 → F2 → F3 → F4a
→ F4b, y F5 puede empezar tras F3 en paralelo con F4.

> **Hotfix previo opcional (F0)**: en `src/components/ReportEditor.tsx:276-299,596-599`, una
> edición online sube los pendientes offline sin confirmación (viola FR-015/SC-004 hoy). Se
> recomienda desactivar el autosave mientras haya pendientes locales hasta que llegue F4a. Es un
> cambio pequeño y aislado.

### Fase 1 — Base de datos

| Paso | Contenido | Cierra (gap-analysis) |
| --- | --- | --- |
| 1.1 | Migraciones `ADD VALUE` (`ROOT`, `CLOSED`) separadas | FR-002, FR-024 (base) |
| 1.2 | Helpers `is_manager`/`is_root`; reescritura de **todas** las políticas `= 'ADMINISTRATOR'` | FR-003, FR-028 (base) |
| 1.3 | `profiles.username`, `created_by`; trigger `ensure_active_root`; `private.login_attempts` | FR-001, FR-004, FR-005 |
| 1.4 | Asignaciones con `id`, `shift_id`, vigencia; migración de datos; `current_shift_at` | FR-007, FR-007b |
| 1.5 | Reportes: `origin`, `received_at`, `approved_*`; trigger fija turno y fecha operativa; índices de un activo por operario y por máquina; se elimina el límite de 5 | FR-007a/b, FR-024a |
| 1.6 | Paradas: horas del dispositivo, `received_at`, `captured_offline`, `clock_skew_review`; sin DELETE | FR-008a, FR-027 |
| 1.7 | `change_types` + `report_change_events` con RLS | FR-008, CA-01-04 |
| 1.8 | Columnas nuevas de `report_audit_log` y `administrative_audit_log`; `sync_operation_log`; `sync_quarantine`; `device_sync_status`; `app_settings` (margen fuera de turno 2 h); tipos de notificación nuevos; vista `production_report_overview` | base de F3/F4, FR-005a |
| 1.9 | RLS objetivo: VIEWER ve todos los estados; managers sin UPDATE en `DRAFT`; operario solo catálogos activos | FR-031, FR-025a, FR-011a |
| 1.10 | `seed.sql` con ROOT y cuentas de desarrollo; pgTAP de todo lo anterior | — |

**Puerta F1**: `db:reset` + `db:test` en verde (incluye las pruebas existentes adaptadas) y los
datos existentes migrados sin pérdida.
**Riesgo**: el cambio de PK de las asignaciones y la reescritura de RLS rompen consultas actuales de
la app. Mitigación: F1 incluye los ajustes mínimos en `src/` para que `bun test` y `build` sigan
pasando (sin funciones nuevas).

### Fase 2 — Roles y aprobación

| Paso | Contenido | Cierra |
| --- | --- | --- |
| 2.1 | Login por usuario + bloqueo (R1/R2); eliminar recuperación, invitación y `/auth/confirmar` | FR-001/001a/004, CA-05-02 |
| 2.2 | Gestión de usuarios: alta con contraseña, reset, asignaciones por turno, matriz ROOT/coordinador, invariante ROOT; bloqueo de desactivación con pendientes o reporte activo + aviso de último contacto | FR-028, FR-005a, CA-04-01/02 |
| 2.3 | Roles y etiquetas nuevas en `types.ts`, middleware y navegación | FR-002 |
| 2.4 | Aprobación (`approve_report`), panel con aprobador y fecha en el detalle y los listados | FR-024/024a/024b, CA-02-05/06 |
| 2.5 | Cancelación: autor, o manager si está fuera de turno (fin de turno + 2 h configurable); marca "Abierto fuera de turno"; RPC `security definer` que validan actor y estado | FR-010a |
| 2.6 | Managers no editan `DRAFT` (UI y API); el editor del admin solo en `SUBMITTED`/`CLOSED` | FR-025a, Fuera de spec #2 |
| 2.7 | Quitar "valor frecuente" del operario; selección solo de activos | FR-011a, Fuera de spec #1 |
| 2.8 | Crear reporte: turno y fecha automáticos, mensaje "solicita asignación", un activo | FR-007/007a/007b, CA-01-01/02 |
| 2.9 | `delete_or_deactivate` en todos los catálogos y máquinas; catálogo de tipos de cambio | FR-026/027, CA-04-04 |

**Puerta F2**: quickstart §Fase 2 + pruebas de rechazo por solicitud directa para cada acción
prohibida de la tabla de roles (SC-007).

### Fase 3 — Auditoría, filtros y Excel

| Paso | Contenido | Cierra |
| --- | --- | --- |
| 3.1 | Trigger de auditoría genérico (cualquier rol, motivo, rol, offline, llegada) — **se adelanta a F2** (antes de las RPC con motivo; hallazgo O1) | FR-029, SC-008 |
| 3.2 | `correct_report` con motivo obligatorio + `CorrectionDialog` | FR-025, CA-02-07 |
| 3.3 | Historial en orden cronológico ascendente, con rol, motivo e indicador offline | CA-03-01 |
| 3.4 | Historial administrativo completo + `/administracion/historial` (solo ROOT) | FR-029a, CA-04-03 |
| 3.5 | Filtros: rango libre, máquina, turno, operario, estado (incluido Cerrado), fecha operativa | FR-023, CA-02-03 |
| 3.6 | Excel: CAMBIOS, HISTORIAL, aprobación; 204 si no hay resultados | FR-033, CA-02-04, CA-03-03 |

**Puerta F3**: quickstart §Fase 3 + pgTAP de auditoría (100 % de las modificaciones registradas) +
pruebas de la exportación.

### Fase 4a — Offline completo del operario

| Paso | Contenido | Cierra |
| --- | --- | --- |
| 4a.1 | IndexedDB v2 (`outbox`, `entities`, `snapshot`) y migración desde v1 sin pérdida | FR-013 |
| 4a.2 | `GET /api/offline/snapshot` y la isla `OperatorShiftApp` en `/turno` (crear, producción, paradas, cambios, enviar, cancelar) | FR-012, CA-01-05/06 |
| 4a.3 | Validación offline (solapamientos, parada abierta, obligatorios, un activo) | FR-009 offline |
| 4a.4 | `apply_sync_operation` + `sync_operation_log` + `POST /api/sync/batch` | FR-017 |
| 4a.5 | Resumen de pendientes, confirmar o posponer, indicador global, sin autosave con pendientes | FR-014/015/016, CA-01-07/08/09, SC-004 |
| 4a.6 | Conflictos y cuarentena, notificaciones `SYNC_CONFLICT` y `OFFLINE_DATA_REVIEW`, revisión del coordinador | FR-018, casos límite |
| 4a.7 | SW: precache de `/turno`, respaldo de navegación; `storage.persist()`; aviso de pendientes > 7 días; logout con pendientes | FR-013, casos límite |

**Puerta F4a**: quickstart §Fase 4a + las garantías verificables de
[sync-protocol.md](./contracts/sync-protocol.md) (SC-003, SC-004).

### Fase 4b — Login offline y consulta offline

| Paso | Contenido | Cierra |
| --- | --- | --- |
| 4b.1 | Verificador PBKDF2 tras el login online, ventana de 7 días, bloqueo local | FR-006/006a, SC-012 |
| 4b.2 | Sesión local con el rol guardado; revalidación online obligatoria antes de subir; `OFFLINE_LOGIN` | FR-006b/006c |
| 4b.3 | `/consulta-offline` + `GET /api/offline/overview` con la marca de hora | FR-020 |

**Puerta F4b**: quickstart §Fase 4b.

### Fase 5 — Tiempo real

| Paso | Contenido | Cierra |
| --- | --- | --- |
| 5.1 | Publicación Realtime y políticas del canal de presencia | — |
| 5.2 | `LiveDashboard` (KPIs, máquinas en parada, fuera de turno) y lista en vivo | FR-021, CA-02-01 |
| 5.3 | `PresenceList` (en línea / con pendientes / sin conexión) | FR-022, CA-02-02 |
| 5.4 | `LiveTimeline` en el detalle para managers y auditores | FR-031, CA-03-02 |
| 5.5 | Polling de respaldo de 8 s | SC-005 |

**Puerta F5**: quickstart §Fase 5 (medir < 10 s).

## Trazabilidad

Cada ❌/🟡 del [gap-analysis.md](./gap-analysis.md) se asigna a una fase en las tablas anteriores.
Los puntos de "Fuera de spec" se resuelven así:

- #1 y #2: F2.
- #3: F1/F3.
- #4: F2.
- #5: F1.
- #7 (DELETE de paradas): F1.
- #8 (horas del servidor): F1.
- #12 (borrado de máquina): F2.
- Se conservan, porque no contradicen la spec: #6 (cancelación de paradas), #9 (notificaciones,
  ahora base de los avisos de conflicto), #10 (cancelación, ahora definida en FR-010a), #11
  (métricas ocultas al operario), #13 (PWA) y #14 (el tablero pasa a usar un rango).

## Riesgos principales

| Riesgo | Mitigación |
| --- | --- |
| Safari iOS borra IndexedDB tras 7 días sin uso | `storage.persist()`, instalación como PWA y aviso de pendientes > 7 días; documentado en el manual de operario |
| Las variaciones del reloj del dispositivo distorsionan las horas | Hora de llegada guardada y `clock_skew_review` > 5 min (FR-008a) |
| La reescritura de RLS abre o cierra accesos por error | pgTAP con matriz completa rol × acción en F1 y F2 (SC-007) |
| Límites de Realtime (conexiones y mensajes) | Suscripciones solo en vistas de manager y auditor; polling de respaldo |
| Migración de las asignaciones existentes sin turno | Expansión a todos los turnos activos y revisión por el coordinador tras desplegar |

## Complexity Tracking

Sin violaciones de gates; no aplica.
