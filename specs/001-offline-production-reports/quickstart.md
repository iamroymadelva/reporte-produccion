# Quickstart — validar la feature 001 fase por fase

## Requisitos

- Bun 1.3+, Docker (Supabase local), Supabase CLI (`bunx supabase`).
- `.env` con `PUBLIC_SUPABASE_URL`, `PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SERVICE_ROLE_KEY`
  (ver `.env.example`).

## Arranque local

```bash
bun install
bun run db:start          # Supabase local
bun run db:reset          # aplica migraciones + seed (crea la cuenta ROOT de desarrollo)
bun run dev               # http://localhost:4321
```

Cuentas de desarrollo creadas por `supabase/seed.sql` (Fase 1): `root`, `coord1`, `auditor1`,
`op1`, `op2` — contraseña `Planta2026!` (solo local).

## Puertas de calidad (en cada fase, evidencia para el GO del auditor)

```bash
bun test                  # unit/integration (happy-dom, fake-indexeddb)
bun run db:test           # pgTAP: RLS, transiciones, auditoría, sync
bunx astro check          # tipos
bun run build             # build de producción
```

## Fase 1 — Base de datos

1. `bun run db:reset` termina sin errores.
2. `bun run db:test` pasa, incluidas las pruebas nuevas:
   - invariante ROOT (no se puede desactivar el último ROOT);
   - `current_shift_at` para Día/Tarde/Noche, incl. 23:30 y 05:30 del turno Noche (fecha operativa
     = día de inicio);
   - un solo `DRAFT` por operario y por máquina;
   - paradas/cambios con hora del dispositivo y `clock_skew_review` cuando la diferencia > 5 min;
   - VIEWER ve reportes en todos los estados; nadie escribe en tablas de auditoría.
3. Los datos existentes migran: asignaciones expandidas por turno; reportes conservan folio y
   estado.

## Fase 2 — Roles y aprobación

1. Login con `root` / contraseña → dashboard. 5 contraseñas erróneas para `op1` → sexto intento
   (aun correcto) muestra el mismo mensaje genérico; tras 15 min entra.
2. `/recuperar-contrasena` y la invitación por correo ya no existen (404/redirección).
3. `coord1` crea un operario con usuario y contraseña inicial, le asigna máquina+turno, restablece
   su contraseña; **no** puede editar `root` ni `auditor1` (UI oculta + 403 por solicitud directa).
4. `op1` inicia reporte en su máquina del turno vigente: fecha operativa y turno se rellenan solos;
   intentar un segundo reporte → bloqueado; enviar → coord ve "Enviado".
5. `coord1` no puede editar un reporte Activo (sin controles; `PATCH` directo → 403); sí "Aprobar y
   cerrar" uno Enviado → "Cerrado (aprobado)" con aprobador y hora visibles para todos.
6. Un reporte Activo cuyo turno terminó hace **menos de 2 h** no se puede cancelar desde `coord1`;
   pasadas **2 h** aparece "Abierto fuera de turno" y `coord1` lo cancela con motivo.
6b. `coord1` intenta retirar a `op1` mientras tiene un reporte activo o pendientes informados → la
   acción está bloqueada ("El usuario tiene datos pendientes de subir o un reporte activo"). Sin
   reporte activo ni pendientes → el diálogo muestra "Último contacto: HH:MM" y exige marcar la
   advertencia antes de retirar.
6c. `op1` inicia una parada sin categoría; al cerrarla se le exige elegir una categoría; no puede
   enviar el reporte con paradas sin categoría.
7. El editor del operario ya no ofrece "guardar como frecuente"; `POST /api/catalogs/frequent` → 404.
8. Eliminar una categoría en uso → queda desactivada; sin uso → eliminada tras confirmar.

## Fase 3 — Auditoría, filtros y Excel

1. `coord1` corrige un reporte Enviado: el motivo es obligatorio; el historial muestra campo, valor
   anterior/nuevo, autor, rol, fecha y motivo en orden cronológico.
2. Ediciones de `op1` en su borrador también aparecen en el historial.
3. `auditor1` ve reportes Activos, Enviados, Cerrados y Cancelados con su historial; no ve
   `/administracion/historial`. `root` sí lo ve, con filtros.
4. Filtros: rango libre + máquina + turno + operario + estado; el Excel respeta exactamente los
   filtros y contiene las hojas CAMBIOS e HISTORIAL y las columnas de aprobación.
5. Filtro sin resultados → mensaje "No hay reportes…", sin descarga.

## Fase 4a — Offline completo del operario

Usar Chrome DevTools → Network → **Offline** (y/o modo avión en una tableta).

1. Con `op1` en línea abrir `/turno` (descarga snapshot). Pasar a Offline.
2. Iniciar reporte, registrar 2 paradas, 1 cambio, datos de producción, recargar la página (sigue
   funcionando desde el shell), registrar otra parada y enviar. Indicador: "Sin conexión — guardado
   en este dispositivo · N pendientes".
3. Volver Online → aparece el resumen; verificar en la BD que **nada** llegó aún. Pulsar
   "Posponer" → nada se sube; el resumen se vuelve a ofrecer.
4. "Confirmar y subir" → el servidor contiene exactamente esos datos (folio asignado, horas del
   dispositivo, `captured_offline=true`), sin duplicados al repetir la subida.
5. Cortar la red a mitad de la subida → los aceptados quedan sincronizados, el resto pendiente.
6. Iniciar sesión con `op2` en el mismo navegador → no ve ni puede subir lo de `op1`.
7. Cerrar sesión con pendientes → advertencia y confirmación explícita.

## Fase 4b — Login offline y consulta offline

1. `op1` inicia sesión online una vez; Offline; cerrar y volver a abrir el navegador → login con
   usuario/contraseña funciona sin conexión (< 15 s). `op2` (nunca entró en este dispositivo) →
   "Necesitas conexión para entrar".
2. Contraseña errónea offline 5 veces → bloqueo local 15 min.
3. Al reconectar se exige login online antes de subir; si `coord1` desactivó a `op1` mientras tanto
   → sesión cerrada, datos conservados para autorización del coordinador.
4. `coord1` y `auditor1` offline ven `/consulta-offline` con "Datos de HH:MM"; exportar/corregir
   deshabilitado.

## Fase 5 — Tiempo real

1. Dos navegadores: `op1` y `coord1`. `op1` inicia reporte y una parada → el tablero de `coord1`
   lo refleja en < 10 s sin recargar; `op1` aparece "En línea".
2. `auditor1` con el detalle abierto: `coord1` corrige el reporte → la entrada aparece en el
   historial sin recargar.
3. Bloquear WebSocket (DevTools) → el tablero sigue actualizándose por polling (≤ 8 s).
