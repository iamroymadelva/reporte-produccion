# Checklist de liberación — pruebas manuales requeridas

**Origen**: auditoría de la Fase 7b (cliente offline) y de las fases anteriores. Las pruebas
automáticas simulan el navegador (happy-dom + fake-indexeddb) y el smoke ejecuta el cliente de
sincronización real contra el servidor local, pero **nunca se ha probado en un navegador ni una
tableta reales**. Estas comprobaciones son obligatorias antes de usar la plataforma en planta.

## A. Condiciones previas al despliegue en producción

- [ ] **No desplegar sin completar la sección E (y B, D, F) en tableta real**: la Phase 8 (inicio de sesión sin conexión) está
  implementada y probada en happy-dom + servidor local, pero falta la prueba en navegador/tableta reales.
- [ ] **Exportación en Vercel**: confirmar la duración máxima de la función de `/api/reports/export` (no hay `maxDuration` en
  `vercel.json` ni en `astro.config`): verificar Fluid compute o fijar `maxDuration` (p. ej. 60 s) y medir SC-006 con un mes real.
- [ ] Ejecutar `supabase/bootstrap-root.sql` (primer administrador raíz) **antes** de usar la
  plataforma: tras migrar no existe ningún ROOT y los administradores actuales pasan a ser
  coordinadores (ver `docs/DEPLOYMENT.md`).
- [ ] La migración **cancela** los reportes activos sobrantes por operario (queda uno solo), con el
  motivo "Cancelado al migrar…". Requiere aprobación explícita del responsable del negocio.
- [ ] Los usuarios existentes entran por **nombre de usuario** (derivado de su correo). Comunicarles
  su nombre de usuario; las contraseñas no cambian. Ya no existe la recuperación por correo.
- [ ] Revisar los permisos de tablas en el proyecto remoto (`anon`/`authenticated`) tras aplicar las
  migraciones; confirmar que no hay `TRUNCATE` ni escritura directa en tablas de auditoría.
- [ ] El `.env.local` apunta a producción: no ejecutar `supabase db push` sin revisar las
  migraciones pendientes una por una.

## B. Navegador y tableta (Chrome/Edge Android, desktop; Safari iOS si se usa)

1. [ ] Instalar la PWA, iniciar sesión como `op1`, abrir `/turno` y confirmar en DevTools →
   Application → Cache Storage que `reporte-produccion-static-v4` contiene `/turno` y sus
   `/_astro` y **ninguna** entrada `/api` ni otro HTML.
2. [ ] Modo avión: turno completo — iniciar reporte, iniciar y cerrar paradas (una sin categoría y
   luego asignarla), añadir un cambio, enviar. Recargar la página sin conexión; cerrar y reabrir la
   app sin conexión. Todo debe seguir ahí.
3. [ ] Reconectar: debe aparecer el resumen **sin** ninguna escritura de red antes de "Confirmar y
   subir" (panel Network). Confirmar y verificar los datos en el servidor.
4. [ ] Cortar la red a mitad de la subida y reintentar: sin duplicados y con la misma `operationId`.
5. [ ] Dejar expirar la sesión (401) con pendientes; iniciar sesión de nuevo y subir.
6. [ ] `op1` cierra sesión con pendientes (aparece la confirmación); `op2` inicia sesión en línea y
   **no** ve datos de `op1`; con el dispositivo sin conexión tras el cierre de sesión no se puede
   operar ("Necesitas conexión para iniciar sesión").
7. [ ] Desplegar una versión nueva del service worker con `/turno` abierto y luego perder la red:
   el shell debe seguir disponible.
8. [ ] `navigator.storage.persisted()` devuelve `true` en la tableta; probar el mensaje de cuota con
   el almacenamiento casi lleno.
9. [ ] Dato pendiente de más de 7 días (o reloj del dispositivo adelantado): aviso persistente;
   con el reloj mal configurado, el servidor debe rechazar horas futuras.
10. [ ] Maquetación móvil (375 px) y texto del indicador: "Sin conexión — guardado en este
    dispositivo · N pendientes".

## C. Coordinación y auditoría (tras desplegar)

11. [ ] KPI "cerrados" del tablero y botón "Cancelar (abierto fuera de turno)" (sin pruebas de UI
    automáticas).
12. [ ] Un coordinador revisa un elemento de cuarentena (marcar revisado / aplicar con motivo).
13. [ ] ROOT usa "Forzar de todos modos" al desactivar un usuario con pendientes; queda
    `FORCE_DEACTIVATE` en el historial administrativo.
14. [ ] Exportar un mes sembrado y medir el tiempo (< 30 s, SC-006); medir el inicio de sesión
    offline en una tableta de gama baja (< 15 s, SC-012) cuando exista la Fase 8.

## D. Añadidos de la re-auditoría de la Fase 7b

15. [ ] **Dispositivo compartido sin conexión**: `op1` cierra sesión con pendientes, el dispositivo
    queda sin conexión y `/turno` muestra "Necesitas conexión para iniciar sesión". `op2` inicia
    sesión en línea y no ve nada de `op1`. Al volver `op1`, sus pendientes reaparecen.
16. [ ] **Respuesta perdida**: cortar la red justo al pulsar "Enviar reporte". Reconectar, confirmar
    y subir: el resultado debe ser "duplicado", sin fila de cuarentena ni notificación
    `OFFLINE_DATA_REVIEW`.
17. [ ] **Actualización del service worker**: (a) hacer fallar `/turno` durante una actualización y
    comprobar que el worker anterior sigue y `/turno` funciona sin conexión; (b) dejar que la
    actualización funcione, pulsar "Actualizar", confirmar una sola recarga y que la caché antigua
    se elimina solo cuando la nueva contiene `/turno`.
18. [ ] **Cambio de rol en un dispositivo**: expira la sesión de un operario y un coordinador inicia
    sesión en el mismo dispositivo; sin conexión `/turno` debe pedir iniciar sesión (la identidad sale
    de la contraseña, Phase 8); un coordinador solo ve `/consulta-offline`.

## E. Phase 8 — inicio de sesión y consulta sin conexión (pruebas en navegador/tableta reales pendientes)

19. [ ] **Matrícula**: iniciar sesión en línea como `op1`, `coord1` y `auditor1` en la misma tableta; en DevTools →
    Application → IndexedDB `reporte-produccion-offline` comprobar `offlineCredentials` (salt/verifier en base64, sin
    contraseña en ningún store) y que el login con contraseña errónea no deja ninguna matrícula.
20. [ ] **SC-012**: en una tableta de gama baja, modo avión, medir el tiempo de «Iniciar sesión» sin conexión
    (PBKDF2 de 600 000 iteraciones; < 15 s). Anotar el modelo y el tiempo. En escritorio con Bun: ~0,3–0,6 s.
21. [ ] **Acceso sin conexión real**: cerrar y reabrir la PWA en modo avión → debe aparecer `/acceso-offline`
    (no `offline.html`). `op1` entra y llega a `/turno`; `coord1`/`auditor1` llegan a `/consulta-offline`; un
    usuario que nunca entró (p. ej. `op2`) ve «Necesitas conexión para entrar». 5 contraseñas erróneas → bloqueo de
    15 min (recargar la página no lo levanta).
22. [ ] **Ventana de 7 días**: adelantar el reloj del dispositivo 8 días (o reducir `offline_login_window` en
    `app_settings`) → «Necesitas conexión para entrar».
23. [ ] **Revalidación**: con datos de `op1` capturados sin conexión, reconectar → el resumen pide «Inicia sesión en
    línea para subir» (sin botón de subida); iniciar sesión en línea y subir. Verificar la fila `OFFLINE_LOGIN` en el
    historial administrativo (ROOT) — también para `coord1`/`auditor1` tras su primera página en línea. Repetir desactivando a `op1` (ROOT/coordinador) mientras estaba sin conexión: la
    sesión se cierra, los datos siguen en el dispositivo, un coordinador lo reactiva y `op1` sube lo suyo.
24. [ ] **Dispositivo compartido**: `op1` cierra sesión sin conexión; `op2` (habilitado en la tableta) entra con SU
    contraseña y no ve nada de `op1`; con conexión, la cookie del servidor de `op1` queda cerrada (cierre pendiente).
25. [ ] **Consulta sin conexión**: `coord1` abre `/consulta-offline` con conexión (se guarda el resumen), modo avión →
    «Datos de HH:MM» y los reportes; Exportar/Corregir/Aprobar/Cancelar/Administración deshabilitados («Requiere
    conexión»). Sin haber descargado nunca: «Aún no hay datos descargados; conéctate para descargarlos».
26. [ ] **Service worker v5**: Cache Storage `reporte-produccion-static-v5` contiene `/turno`, `/consulta-offline` y
    `/acceso-offline` (y sus `/_astro`) y ningún HTML autenticado ni `/api`.
27. [ ] **Cookies de sesión**: en DevTools → Application → Cookies comprobar que `sb-*` NO es HttpOnly (comportamiento por defecto de `@supabase/ssr`); el logout sin conexión las borra con JavaScript. Si algún día fueran HttpOnly, el borrado sería imposible y quedaría solo el cierre pendiente en el servidor: **riesgo aceptado** documentado.
28. [ ] **Reloj atrasado un día con sesión de A abierta** (ronda 3): con la sesión en línea de `A` abierta, atrasar el reloj de la tableta un día, ir a `/iniciar-sesion` sin conexión, escribir el usuario de `A` con OTRA contraseña, reconectar y abrir `/reportes`. Después, sin conexión, entrar con esa otra contraseña **debe fallar** (la matrícula no se confirma porque la sesión es anterior a la hora del servidor).
30. [ ] **Reloj adelantado 5 min**: con el reloj de la tableta adelantado 5 minutos, un login en línea normal debe dejar la tableta habilitada para entrar sin conexión (el reloj del dispositivo no descarta matrículas legítimas).
31. [ ] **Cookies en producción**: comprobar en DevTools → Application → Cookies, en el entorno de producción, si las cookies `sb-*` son HttpOnly (en local no lo son); si lo fueran, el borrado con `document.cookie` del logout sin conexión no funcionaría y quedaría solo el cierre pendiente en el servidor (riesgo aceptado, ver #27).
29. [ ] **Migraciones**: `20261015000100_record_offline_login.sql` (crea `record_offline_login` y un índice único parcial en `administrative_audit_log`); ya no existe la operación `OFFLINE_LOGIN` del lote ni la migración `20261014000100_offline_login_audit.sql` (retirada antes de cualquier despliegue).
32. [ ] **Política de dispositivo** (auditor, Fase 8): tabletas en modo kiosco o gestionadas, con hora automática (NTP) bloqueada y sin acceso a DevTools. Cubre las limitaciones conocidas: la ventana de 7 días, el bloqueo local y la sesión local dependen del reloj del dispositivo (offline no hay hora de confianza), y los datos de consulta offline están en texto plano en IndexedDB.
33. [ ] **Limitación aceptada (b)**: la matrícula offline se ata a la hora de inicio de sesión del servidor, no a la sesión concreta; un inicio de sesión del mismo usuario en otro dispositivo dentro de los 10 min de un registro pendiente podría confirmarlo. Mejora futura: leer `auth.sessions` con una función `security definer`. Mitigación futura: guardar la hora máxima observada y exigir conexión si el reloj retrocede.

## F. Fase 9 — tiempo real (auditor)

34. [ ] Dos navegadores, OPERATOR A y OPERATOR B: B no recibe eventos ni recargas de los reportes de A; un VIEWER sí.
35. [ ] El tablero se actualiza en < 5 s ante envío, parada o aprobación. Bloqueando el WebSocket `/realtime/v1/websocket` (DevTools) aparece el modo de actualización automática cada 8 s; al desbloquear vuelve a "En vivo".
36. [ ] Presencia: operario conectado "En línea"; con pendientes "En línea con pendientes"; sin red o pestaña cerrada "Sin conexión" con la última vez. En modo avión `/turno` no da errores de Realtime.
37. [ ] Tras cerrar sesión no queda abierto el WebSocket de Realtime.
38. [ ] Cache Storage tras usar el tablero: sin HTML autenticado ni respuestas `/api`.
39. [ ] Producción: la publicación `supabase_realtime` solo contiene las 5 tablas y Realtime tiene activada la autorización de canales privados; las cookies `sb-*` no deben ser HttpOnly para que el cliente de Realtime lea la sesión.
40. [ ] Limitación aceptada: la presencia es solo indicativa (un operario con DevTools podría falsear el `userId` de su payload); no concede permisos ni alimenta FR-005a.
