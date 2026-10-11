# reporte-produccion Development Guidelines

Auto-generated from all feature plans. Last updated: 2026-10-09

## Active Technologies

- TypeScript 5.9 — Astro 7 SSR (`@astrojs/vercel`) + React 19 islands, Tailwind 4 + shadcn/Radix (redesign/ui-ux)
- Supabase: Auth, PostgREST, PostgreSQL with RLS/triggers (SQL/PLpgSQL), Realtime (planned F5) (redesign/ui-ux)
- ExcelJS 4 for server-side Excel export; IndexedDB + WebCrypto in the browser for offline mode (redesign/ui-ux)

## Project Structure

```text
src/            # Astro pages, API routes (src/pages/api), React islands (src/components), libs (src/lib)
supabase/       # migrations/, seed.sql, tests/ (pgTAP)
public/         # sw.js (service worker), manifest, icons, offline.html
tests/          # bun test (happy-dom, fake-indexeddb)
specs/          # Spec Kit features (001-offline-production-reports: spec, plan, research, data-model, contracts)
docs/           # Architecture, data model, PWA/offline, security, TESTING.md (pruebas locales)
```

## Commands

bun test; bun run db:test; bunx astro check; bun run build; bun run db:reset (local Supabase)

**WARNING: `.env.local` = PRODUCCIÓN.** `bun run dev` fuerza el Supabase local (scripts/dev-local.ts); `bun run dev:remote` usa `.env.local`. Ver [docs/TESTING.md](docs/TESTING.md).

## Code Style

Spanish UI (es-CO, America/Bogota). Authorization lives in the database (RLS + triggers); API routes re-check roles. Never cache authenticated HTML or data in Cache Storage.

## Recent Changes

- redesign/ui-ux: Plan 001 (offline production reports, ROOT role, approval, full audit, realtime) — see specs/001-offline-production-reports/plan.md

<!-- MANUAL ADDITIONS START -->
<!-- MANUAL ADDITIONS END -->
