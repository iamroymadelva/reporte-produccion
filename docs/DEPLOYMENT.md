# Deployment Guide

## Prerequisites

- Bun compatible with the repository lockfile and scripts.
- Supabase CLI.
- A Supabase project.
- A Vercel account and project.
- A Git repository and permission to deploy it.

## Environment Variables

| Name | Use |
| --- | --- |
| `PUBLIC_SUPABASE_URL` | Supabase project URL used by the application. |
| `PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Browser-safe publishable key; access remains constrained by RLS. |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-only administrative key. Never expose it to browser bundles, logs, or client configuration. |

Store values in environment-specific secret management. This repository documentation does not include credential values.

## Local Setup

```sh
bun install
bun run db:start
bunx supabase status
bun run dev
```

> `bun run dev` always uses the local Supabase (`.env`), ignoring `.env.local` (production). See [TESTING.md](TESTING.md).

The local seed creates demonstration identities for isolated development. Inspect or replace local-only credentials before starting the stack, and never reuse them in shared or Cloud environments.

## Database Migration Workflow

Database changes are versioned in `supabase/migrations`.

```sh
bunx supabase link --project-ref <PROJECT_REF>
bunx supabase db push --dry-run
bunx supabase db push
```

Review dry-run output before applying migrations. **Never run `supabase db push` from a working copy whose `.env.local` points at production without reviewing the pending migrations one by one**; use the local stack (`bun run db:reset`) for every rehearsal.

### Migration order

Migrations apply strictly in filename order and must not be renamed or reordered. The feature 001 chain is:

1. `20261010000100_app_role_root` and `20261010000200_report_status_closed`: enum values (`ROOT`, `CLOSED`), each in its own migration so later migrations can use them.
2. `20261010000300` to `20261010000800`: roles and profiles, device-time reports and stops, change events, audit and sync tables, target RLS, notification types.
3. `20261011000100` to `20261011000510`: login lockout, user management (and the lock on user tables), catalog delete-or-deactivate, full audit, approval and cancellation, `correct_report`, off-shift legacy drafts.
4. `20261012000200_admin_audit`: administrative audit triggers.
5. `20261013000100_offline_sync` and `20261013000200_drop_frequent_values`: offline sync RPC and removal of frequent values.
6. `20261015000100_record_offline_login`: offline sign-in audit RPC and its partial unique index (the withdrawn `20261014000100` was never deployed).
7. `20261016000100_realtime_publication`: adds five tables to `supabase_realtime` and the `plant-presence` policies on `realtime.messages`.

Applying them also **cancels the surplus active reports per operator** (one remains) with the reason "Cancelado al migrar…", turns existing administrators into coordinators and expands assignments per shift. This needs explicit approval from the business owner before running against production. After migrating, run the ROOT bootstrap below before using the platform. Apply only the expected pending migrations, then perform functional verification. Do not place a real project reference in committed documentation or scripts unless the repository intentionally treats it as non-secret configuration.

## First ROOT Bootstrap (run once, before anything else)

After the migrations are applied and **before** any other administration, promote one existing user to the root administrator (`ROOT`) role with `supabase/bootstrap-root.sql`. Migrations and `seed.sql` never run it automatically; production has no seeded users, so first create the account (Supabase Dashboard > Authentication > Add user, with `email_confirm`, and optionally `user_metadata` `{"full_name": "...", "username": "..."}`; the profile row is created by trigger as an inactive `OPERATOR`).

```sh
# Identify the user by username or by auth email. The connection string comes from your environment, never from the repository.
psql "$DATABASE_URL" -v identifier='mi.usuario' -f supabase/bootstrap-root.sql
```

The script is idempotent: it sets `role = 'ROOT'`, `active = true`, clears any retirement and auth ban, writes a `BOOTSTRAP_ROOT` row in `administrative_audit_log`, and fails without changes if the identifier matches zero or more than one user. To verify, the script prints the active ROOT profiles at the end; you can also run `select username, role, active from public.profiles where role = 'ROOT' and active;` and then sign in with that username. From then on ROOT creates coordinators and auditors from `/administracion/usuarios`; coordinators create operators.

## Cloud Auth and Realtime Checklist

Local template and configuration files do not prove the corresponding Supabase Cloud settings. Verify each item in the target project:

- [ ] Public signup is disabled: accounts are created only by managers (username and initial password). Email invitation, recovery and confirmation flows are **not used**; no email templates or callback URLs (`/auth/confirmar`) are required.
- [ ] The users' synthetic emails (`<username>@usuarios.reporte-produccion.invalid`) never receive mail; do not configure SMTP for them.
- [ ] Realtime is enabled for the project and **private channel authorization is on** (required for the `plant-presence` policies).
- [ ] The `supabase_realtime` publication contains exactly `production_reports`, `report_stop_events`, `report_change_events`, `report_audit_log` and `sync_quarantine` (`select tablename from pg_publication_tables where pubname = 'supabase_realtime'`).
- [ ] Table privileges for `anon`/`authenticated` are as migrated: no `TRUNCATE` and no direct writes to the audit, sync or user tables.
- [ ] The `sb-*` session cookies are readable by the browser (not HttpOnly) in the deployed domain: Realtime and the offline sign-out depend on it. If the platform makes them HttpOnly, offline sign-out only leaves a pending server-side close (accepted risk).

## Vercel

The repository uses Astro server output with the official Vercel adapter. Configure the Vercel project to install dependencies with Bun, run `bun run build`, and provide all three environment variables in the required deployment environments. Apply Supabase migrations and complete Cloud Auth configuration before production verification.

### Function duration (Excel export, SC-006)

`astro.config.mjs` sets `vercel({ maxDuration: 60 })`. `@astrojs/vercel` 11.x only supports a global `maxDuration` (applied to the single SSR function through `.vc-config.json`), not per route, so the 60 s limit covers every route including `GET /api/reports/export`. Locally a one-month export took 17.7-25.8 s. The configuration is done, but the measurement on Vercel with a real month (SC-006, < 30 s) is still pending; confirm in the Vercel project settings that the plan/Fluid compute allows 60 s (not verified from the repository).

If Git-based automatic deployment is enabled in the Vercel project, pushes to the configured production branch can trigger deployments. The repository itself does not establish that this integration or branch mapping is enabled.

## Post-Deployment Verification

Use isolated test identities and records to verify:

- Login by username for each role (`ROOT`, coordinator, operator, auditor) and its landing page; the sixth attempt after five failures stays locked for 15 minutes with the same generic message.
- A coordinator cannot edit a coordinator, an auditor or the ROOT (UI hidden and direct request `403`); only ROOT sees `/administracion/historial`.
- Operator: start a report on an assigned machine in the current shift, a second active report is blocked, stops and changes, submit.
- Coordinator: cannot edit an active report; approves a submitted report ("Cerrado (aprobado)" with approver and time); corrects with a reason; cancels an off-shift report only after the 2-hour margin.
- Auditor: sees every state and the history, no edit controls, direct writes are rejected.
- Full audit: the report history and `/administracion/historial` show the actions above.
- Excel export with date range, machine, shift, operator and status filters (sheets SEGUIMIENTO PRODUCCIÓN, DETALLE PARADAS, CAMBIOS, HISTORIAL), the empty result (`204`) and the operator denial.
- Offline: a full shift on a real tablet in airplane mode, upload only after "Confirmar y subir", offline sign-in, and the offline consultation page (see `specs/001-offline-production-reports/release-checklist.md`).
- Real time: two browsers, the dashboard of a coordinator reflects an operator's report in a few seconds; with the WebSocket blocked the dashboard falls back to 8-second polling.
- User retirement and reactivation with the same identity; deactivating a user with a pending report is blocked.
- RLS isolation between roles and between operators.

## Updating the Application

Use `main` as the stable branch and keep changes scoped:

```text
feature branch
  -> test
  -> commit
  -> merge
  -> push
```

For database changes:

```text
new migration
  -> dry-run
  -> push migration
  -> functional validation
  -> commit/push
```

The repository does not contain evidence of a CI/CD workflow, backup policy, disaster-recovery procedure, or automated rollback. Establish and document those operational controls separately before relying on them in production.

## PWA Release Checklist

- Serve the production origin over HTTPS.
- Verify `/manifest.webmanifest`, `/offline.html`, `/sw.js`, and all declared icon paths.
- Keep `/sw.js` revalidating and do not add CDN rules that make it immutable.
- When caching rules or precached files change, increment `CACHE_VERSION` in `public/sw.js` before deployment.
- Test an upgrade from the previous worker: the new worker must wait, the UI must offer **Actualizar**, and activation must remove only older `reporte-produccion-static-*` caches.
- Confirm dynamic authenticated HTML and API responses include `Cache-Control: private, no-store` while `/_astro/` remains immutable.
- Inspect Cache Storage and confirm it contains no authenticated HTML, report data, catalog data, exports, or Auth responses.
- Confirm `CACHE_VERSION` is `v5` and Cache Storage contains `/turno`, `/consulta-offline` and `/acceso-offline` (and their `/_astro/` assets) and nothing else HTML.
- Complete browser-tab and installed-PWA offline/reconnect checks described in [PWA y base de funcionamiento sin conexión](PWA_OFFLINE.md).
