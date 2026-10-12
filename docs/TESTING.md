# Guía de pruebas locales

> **ADVERTENCIA: `.env.local` apunta a PRODUCCIÓN.** Vite le da prioridad sobre `.env`. Por eso `bun run dev`
> ejecuta `scripts/dev-local.ts`, que lee **solo** `.env`, exige que las URLs de Supabase sean locales
> (`127.0.0.1`/`localhost`) y pasa esas variables al proceso de `astro dev` (las variables de proceso
> ganan a `.env.local`). `bun run dev:remote` ejecuta `astro dev` a secas y **sí usa `.env.local`
> (producción)**: no lo uses para pruebas.

## Requisitos

- Bun (ver `packageManager` en `package.json`) y `bun install`.
- Docker en ejecución.
- Supabase CLI (viene como dependencia: `bunx supabase`).

## Puesta en marcha

```sh
bun run db:start   # levanta Supabase local (API en http://127.0.0.1:54321)
bun run db:reset   # aplica migraciones y supabase/seed.sql (datos y usuarios de prueba)
bun run dev        # app en http://localhost:4321, siempre contra el Supabase local
```

Si Supabase local no responde, el script avisa que ejecutes `bun run db:start`. Para apagarlo: `bun run db:stop`.
Nota: Astro 7 puede dejar el servidor en segundo plano; detenlo con `bunx astro dev stop`.

## Usuarios sembrados

Contraseña de todos: `Planta2026!` (solo entorno local).

| Usuario | Rol | Qué ve |
| --- | --- | --- |
| `root` | ROOT | Todo, incluida Administración e Historial administrativo. |
| `coord1` | ADMINISTRATOR | Dashboard, reportes (aprobación) y Administración (sin historial administrativo). |
| `auditor1` | VIEWER | Solo lectura: dashboard, reportes y notificaciones; sin Administración ni edición. |
| `op1`, `op2` | OPERATOR | Captura de reportes de su turno/máquinas asignadas; sin Administración. |

## Pruebas manuales

### Modo offline

1. Inicia sesión como `op1` y abre un reporte (con conexión, para precargar el catálogo).
2. DevTools → Network → marca **Offline**.
3. Edita el reporte: debe guardarse en el dispositivo (borrador/cola) y mostrarse el aviso de modo sin conexión.
4. Desmarca Offline: la cola se sincroniza; verifica el estado en el reporte.
5. Instalar PWA: en Chrome/Edge, icono de instalar en la barra de direcciones (o menú → Instalar). Application → Service Workers permite revisar `sw.js`.

### Tiempo real

1. Abre dos navegadores (o uno normal y uno privado).
2. En el A entra como `op1`; en el B como `coord1` (dashboard o lista de reportes).
3. Crea/edita/envía un reporte en A: B debe actualizarse sin recargar y mostrar notificaciones.

### Menú de ayuda (?)

1. Entra con cada rol (`op1`, `coord1`, `auditor1`, `root`) y pulsa el **?** de la barra superior: abre `/ayuda` con solo el contenido de ese rol. Sin sesión, `/ayuda` redirige al inicio de sesión.
2. Como `op1`, en `/turno` abre el panel **¿Necesitas ayuda?**; con DevTools → Network → **Offline** debe seguir funcionando y no generar peticiones.
3. Revisa a 375 px que no hay desplazamiento horizontal.
4. Para rehacer las capturas de `public/ayuda/` (datos de prueba locales): `bun run db:reset` y luego `bun scripts/capture-help.ts`. El script arranca `bun run dev` en primer plano, usa el Chrome instalado (variable `CHROME` si está en otra ruta), y al terminar ejecuta `bunx astro dev stop`.

Las pruebas automáticas están en `tests/help-menu.test.tsx` (contenido por rol, navegación, acordeón accesible y panel del operario) y `tests/role-access.test.ts` (`/ayuda` exige sesión).

## Comandos de prueba automatizada

```sh
bun test           # pruebas unitarias/API/UI (happy-dom, fake-indexeddb)
bun run db:test    # pgTAP contra Supabase local (requiere db:start)
bunx astro check   # tipos
bun run build      # build de producción (no cambia con dev-local)
```

Al probar la API con `curl`, envía la cabecera `Origin` igual al host (p. ej. `-H "Origin: http://localhost:4321"`); si no, Astro responde 403 por protección CSRF.
