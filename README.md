# Reporte Diario de Producción y Mantenimiento

Aplicación web para digitalizar el reporte diario de producción y mantenimiento de la empresa.

## Stack

- Astro con renderizado en servidor
- Tailwind CSS
- React para islas interactivas
- Adaptador oficial de Vercel
- Supabase PostgreSQL, Auth y RLS

## Desarrollo local

Instala las dependencias:

```sh
bun install
```

Inicia Supabase local y consulta sus claves:

```sh
bun run db:start
bunx supabase status
```

Copia la URL, la clave pública y la clave secreta local a `.env.local` usando los nombres definidos en `.env.example`. Después ejecuta:

```sh
bun run dev
```

La aplicación quedará disponible en `http://127.0.0.1:4321`.

### Usuarios locales de demostración

| Rol | Correo | Contraseña |
| --- | --- | --- |
| Administrador | `admin@local.test` | `Admin123!` |
| Operador | `operador@local.test` | `Operador123!` |
| Consulta | `visor@local.test` | `Visor123!` |

Estas cuentas existen únicamente en la semilla del stack local.

## Base de datos local

```sh
bun run db:reset
bun run db:test
bun run db:stop
```

## Compilación

```sh
bun run build
```

La interfaz dirigida a usuarios se desarrolla completamente en español. El esquema, las migraciones y las políticas RLS de Supabase se mantienen versionados en `supabase/`.

## Preparación para despliegue

El proyecto está configurado para Astro SSR en Vercel. En el entorno de producción deben definirse `PUBLIC_SUPABASE_URL`, `PUBLIC_SUPABASE_PUBLISHABLE_KEY` y `SUPABASE_SERVICE_ROLE_KEY`; la última es exclusivamente de servidor y nunca debe exponerse al navegador. Las migraciones de `supabase/migrations/` deben aplicarse al proyecto Supabase Cloud elegido antes de publicar la aplicación.
