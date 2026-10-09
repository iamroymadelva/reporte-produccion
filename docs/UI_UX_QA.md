# QA y auditoría de cambios: rediseño UI/UX con shadcn

| Campo | Valor |
| --- | --- |
| Fecha | 2026-10-08 |
| Rama | `redesign/ui-ux` |
| Auditoría de referencia | [`UI_UX_AUDIT.md`](UI_UX_AUDIT.md) |
| Entorno | Local: `astro dev` en `localhost:4321` y Supabase local en Docker (`supabase db reset` con el seed) |
| Veredicto final | **GO**, emitido por el auditor independiente en la segunda revisión |

## 1. Proceso

| Paso | Resultado |
| --- | --- |
| Fase 0: respaldo del trabajo previo | Commit `e4d59e2` |
| Fase 1: auditoría documentada | `UI_UX_AUDIT.md` |
| Fase 2: fundaciones shadcn, tokens y modo oscuro | NO-GO (bloque `.dark` residual del CLI) → corregido → GO, commit `ab9c097` |
| Fases 3 y 4: shell, campana y componentes reutilizables | Hechas en paralelo. QA en navegador: NO-GO por un fallo de SSR en dev (dos copias de React, faltaba preoptimizar `sonner`) → corregido |
| Primera QA visual | NO-GO: `accent` ámbar en menús y skeleton, texto "0reportes", paquete `cn` duplicado, CSS legacy → corregido |
| Primera auditoría independiente | NO-GO: 4 mayores (logout desmontado, doble `<h1>`, colores de `StopIndicator`, contraste AA de badges) y 10 menores → todos corregidos |
| QA de las correcciones | Regresión: los diálogos de administración quedaron sin nombre accesible → corregido |
| Segunda auditoría independiente | **GO**: 14/14 hallazgos resueltos, sin mayores nuevos |

## 2. Verificación automática (último ciclo)

| Comando | Resultado |
| --- | --- |
| `bun test` (dos corridas) | 66 pass, 0 fail, 327 `expect()` en 6 archivos |
| `bunx astro check` | 131 archivos: 0 errores, 0 warnings, 4 hints preexistentes |
| `bun run build` | Complete |
| `bun run db:test` (pgTAP) | 10 archivos, 192 tests, PASS |

Tests nuevos:
- `tests/ui-shell.test.tsx`: `navForRole`, `isActivePath`, `breadcrumbFor`, `NotificationBell` (conteo, "99+", marcar todas, vacío), la carrera del store de notificaciones y el nombre accesible de `AdminDialogHost`.
- `tests/report-status.test.tsx`: variantes de estado, `hasActiveStop`, `StatusBadge` y `StopIndicator`.

## 3. QA manual en navegador

Hecha con el usuario administrador del seed local.

| Caso | Resultado | Evidencia |
| --- | --- | --- |
| Sidebar `collapsible="icon"` con grupos, Administración desplegable e indicador activo | OK | `qa/after-dashboard-1440-light-menu.jpg` |
| Menú de cuenta con modo oscuro (persiste en `localStorage.theme`, sin parpadeo, se mantiene al navegar) | OK | `qa/after-dashboard-1440-dark.jpg` |
| Campana: estado vacío, después notificación real `STOP_STARTED` (el operario inicia una parada por la API y el admin ve el badge en la campana y en la barra inferior) | OK | `qa/after-campana-notificacion.jpg` |
| KPIs y badges de estado tras crear el reporte de prueba | OK | `qa/after-dashboard-kpis-dark.jpg` |
| Móvil a 375 px: barra inferior y sin scroll horizontal (`scrollWidth = clientWidth`) | OK | `qa/after-reportes-375-dark.jpg` |
| "Más" abre el sidebar en un Sheet | OK | `qa/after-sheet-375-dark.jpg` |
| Tabla de usuarios y modal Editar: un solo botón Cerrar, foco dentro, `aria-labelledby` hacia el título visible | OK | `qa/after-usuarios-1440-dark.jpg` |
| Detalle de reporte: un único `<h1>`, folio en fuente mono, editor y paradas | OK | `qa/after-detalle-reporte-dark.jpg` |
| Toast con `?ok=`: aparece y limpia la URL | OK | Verificado por DOM (`[data-sonner-toast]`) |
| Cerrar sesión desde el menú de cuenta | OK | Redirige a `/iniciar-sesion` |

Capturas anteriores al cambio: `qa/before-*.jpg`.

## 4. Pendientes menores (no bloquean el GO)

| ID | Descripción | Propuesta |
| --- | --- | --- |
| N1 | Si se cierra un diálogo de administración mientras se muestra "Comprobando conexión…", el formulario se envía igual, porque `BaseLayout` reinserta el form desconectado | Reinsertar solo los forms marcados (p. ej. `data-submit-detached-ok`, usado en logout) |
| N2 | `cancel()` de `ReportEditor` no marca `finalizing`; con cambios locales, el `reload` posterior muestra el aviso nativo de `beforeunload` | Marcar el estado de salida antes del `reload`, igual que `submit` |
| N3 | Solo en desarrollo: Radix advierte "DialogContent requires a DialogTitle" en los diálogos con título del template | Renderizar el `h2` como `DialogTitle` |
| N4 | Registro del service worker: el navegador embebido de pruebas rechaza el registro aunque `/sw.js` responde 200. `public/sw.js` no cambió en este ciclo | Confirmar en Chrome (DevTools › Application) |
| UX-15 | `ReportEditor.tsx` (950 líneas) sigue sin dividirse | Ciclo siguiente |
| Íconos PWA | `public/icons/*` todavía en verde | Regenerar con la paleta azul y ámbar |
