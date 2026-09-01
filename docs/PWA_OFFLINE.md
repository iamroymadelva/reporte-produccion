# PWA y base de funcionamiento sin conexión

## Alcance actual

La aplicación incluye un manifiesto instalable, iconos neutrales, una página estática de contingencia, detección de conectividad y un service worker conservador. Esta base mejora la instalación y comunica interrupciones, pero los datos de producción siguen siendo autoritativos únicamente en el servidor.

Block 3A agrega únicamente infraestructura interna: contrato compartido de campos editables, concurrencia optimista opcional para guardados de borradores del Operador y una base IndexedDB nativa con stores `reportDrafts`, `outbox` y `leases`. Sus APIs soportan escrituras atómicas y confirmación protegida por `localRevision`.

Esta infraestructura todavía no está conectada al editor. No existe edición offline habilitada, no se escriben borradores locales desde la interfaz, no hay sincronización automática, no hay UI global de pendientes y no se usa Background Sync. Crear, editar, guardar, iniciar o cerrar paradas, enviar, cancelar y administrar continúan requiriendo conexión confirmada.

## Límite de caché

El service worker solo controla solicitudes `GET` del mismo origen:

- Las navegaciones siempre consultan la red. Si la red falla, muestran `/offline.html`; el HTML autenticado nunca se guarda en Cache Storage.
- Los recursos con hash bajo `/_astro/` usan cache-first.
- El manifiesto usa network-first con respaldo en caché.
- Solo los iconos declarados y la página de contingencia se precargan.
- `/api/**`, respuestas de Supabase, exportaciones, autenticación, datos de reportes y mutaciones nunca se almacenan.

Las respuestas dinámicas de Astro se entregan con `Cache-Control: private, no-store`. El middleware, Supabase Auth, perfiles activos, roles, RLS y las restricciones de base de datos continúan siendo las barreras de autorización.

## Conectividad y mutaciones

Los eventos `online` y `offline` del navegador se combinan con `HEAD /api/health`. La comprobación tiene timeout y reintento limitado únicamente cuando el servidor permanece inaccesible y la página está visible. El endpoint prueba el origen de la aplicación, no el estado completo de Supabase.

Una mutación conocida como offline o inaccesible no se envía. Si la red falla después de enviar una solicitud, la interfaz indica que el resultado es incierto y no reintenta automáticamente. El usuario debe recuperar la conexión y actualizar para reconciliar con el servidor.

En un editor abierto, los valores ya escritos permanecen solamente en memoria. Al perder conectividad se bloquea la edición, se muestran como cambios sin guardar y no se persisten ni se envían automáticamente al reconectar. El guardado posterior debe ser explícito.

## Versionado y actualizaciones

El service worker usa el prefijo de caché `reporte-produccion-static` y una versión explícita en `public/sw.js`. Al modificar reglas de caché o archivos precargados:

1. Cambie `CACHE_VERSION`.
2. Construya y despliegue la aplicación.
3. Verifique que aparezca **Nueva versión disponible** en una sesión controlada por el worker anterior.
4. Pulse **Actualizar** y confirme una única recarga.
5. Inspeccione que solo se hayan eliminado cachés antiguas con el prefijo de esta aplicación.

Las actualizaciones no ejecutan `skipWaiting` automáticamente. `/sw.js` se sirve con revalidación y se registra con `updateViaCache: "none"`.

## Recuperación manual

Si un navegador conserva un worker histórico o datos desconocidos:

1. Abra DevTools > Application > Service Workers y pulse **Unregister** para este origen.
2. En Application > Storage, revise Cache Storage antes de eliminar datos del sitio.
3. Recargue con conexión y confirme que `/sw.js`, el manifiesto y los iconos responden correctamente.
4. Evite scripts que borren cachés arbitrarias; la aplicación solo limpia nombres que empiezan por su prefijo propio.

En dispositivos móviles puede ser necesario eliminar los datos del sitio desde la configuración del navegador y volver a añadir la aplicación a la pantalla de inicio.

## Dispositivos compartidos

Cerrar la pestaña o la PWA no cierra la sesión. El cierre de sesión requiere conexión para ser confirmado por Supabase. Las cachés estáticas pueden permanecer después de salir porque no contienen perfiles ni reportes, pero el almacenamiento del navegador persiste hasta que el usuario o el sistema lo elimine.

En tabletas compartidas, cierre la sesión mientras haya conexión y no trate una pantalla autenticada que quedó abierta sin red como información actualizada.

## Fundación de datos local

La base `reporte-produccion-offline`, versión 1, define datos aislados por `userId`:

- `reportDrafts`: una copia local por usuario/reporte con valores editables aprobados, versión base y revisión local.
- `outbox`: como máximo una operación `SAVE_REPORT` coalescida por usuario/reporte.
- `leases`: coordinación local genérica para una integración multi-pestaña posterior.

Una escritura pendiente actualiza snapshot y outbox en la misma transacción. Una confirmación del servidor solo puede borrar la revisión exacta enviada; si ya existe una revisión local mayor, se conserva y se actualiza su versión base. Las APIs no almacenan tokens, perfiles completos, catálogos ni filas completas de `production_reports`.

Block 3B deberá conectar esta base al ciclo de edición y autoguardado. Un bloque posterior implementará el flusher, reintentos, estados visibles y recuperación. Hasta entonces IndexedDB permanece sin uso por la UI.

