# PWA y base de funcionamiento sin conexión

## Alcance actual

La aplicación incluye un manifiesto instalable, iconos neutrales, una página estática de contingencia, detección de conectividad y un service worker conservador. Esta base mejora la instalación y comunica interrupciones, pero los datos de producción siguen siendo autoritativos únicamente en el servidor.

No existe persistencia de reportes en IndexedDB, outbox, reintento automático, Background Sync ni resolución de conflictos. Crear, editar, guardar, iniciar o cerrar paradas, enviar, cancelar y administrar requieren conexión confirmada.

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

## Dirección futura

Un bloque posterior podrá introducir una outbox separada del controlador de conectividad. Antes de habilitarla deberá definir identidad propietaria, UUID de operación, tipo, entidad, payload, timestamps, orden, idempotencia, versión base, reintentos, errores y limpieza segura. Nada de ese almacenamiento o replay forma parte de la implementación actual.

