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

The local seed creates demonstration identities for isolated development. Inspect or replace local-only credentials before starting the stack, and never reuse them in shared or Cloud environments.

## Database Migration Workflow

Database changes are versioned in `supabase/migrations`.

```sh
bunx supabase link --project-ref <PROJECT_REF>
bunx supabase db push --dry-run
bunx supabase db push
```

Review dry-run output before applying migrations. Apply only the expected pending migrations, then perform functional verification. Do not place a real project reference in committed documentation or scripts unless the repository intentionally treats it as non-secret configuration.

## Cloud Auth Checklist

Local template and configuration files do not prove the corresponding Supabase Cloud settings. Verify each item in the target project:

- [ ] Set the production Site URL.
- [ ] Allow the absolute callback URL ending in `/auth/confirmar`.
- [ ] Configure invitation email content to send `token_hash` with `type=invite` to that callback.
- [ ] Configure recovery email content to send `token_hash` with `type=recovery` to that callback.
- [ ] Review the sender and SMTP/email-delivery configuration.
- [ ] Confirm public signup remains consistent with the intended invitation-only workflow.

## Vercel

The repository uses Astro server output with the official Vercel adapter. Configure the Vercel project to install dependencies with Bun, run `bun run build`, and provide all three environment variables in the required deployment environments. Apply Supabase migrations and complete Cloud Auth configuration before production verification.

If Git-based automatic deployment is enabled in the Vercel project, pushes to the configured production branch can trigger deployments. The repository itself does not establish that this integration or branch mapping is enabled.

## Post-Deployment Verification

Use isolated test identities and records to verify:

- Administrator, Operator, and Viewer login and landing behavior.
- Role-specific dashboard and report visibility.
- Operator report creation on an assigned active machine.
- START/STOP downtime flow and open-stop restrictions.
- Report submission and cancellation.
- Administrator catalog and user operations.
- Administrator and Viewer Excel export, plus Operator denial.
- User retirement and reactivation with the same identity.
- RLS isolation between roles and between operators.
- Invitation and password-recovery callback URLs in the deployed domain.

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
