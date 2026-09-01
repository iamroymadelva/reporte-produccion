# API Reference

This reference describes the internal HTTP routes implemented under `src/pages/api`. They support the server-rendered application and are not established as a public third-party API.

## Authorization Architecture

Protected requests use the cookie-backed Supabase SSR client. Middleware rejects unauthenticated protected API requests with JSON `401` responses and blocks role-inappropriate administration routes with `403`; endpoint checks add operation-specific rules. Queries and mutations remain subject to PostgreSQL RLS. The server-only admin client is used only where Supabase Auth Admin operations are required.

Form endpoints generally redirect with Spanish flash-message query parameters. Interactive report endpoints generally return JSON. Raw database messages observed on some report mutation error paths are implementation details and are **not** a stable API contract; clients must not depend on their wording.

## Authentication

### `POST /api/auth/login`

- **Purpose:** Sign in with email and password.
- **Authentication:** Public route.
- **Input:** Form data: `email`, `password`.
- **Rules:** Uses Supabase password authentication; failures return a safe Spanish login error.
- **Success:** Redirect to `/`, which dispatches to the authenticated landing page.
- **Response:** Redirect.

### `POST /api/auth/logout`

- **Purpose:** End the current Supabase session.
- **Authentication:** Publicly routable; signs out any available session.
- **Input:** No application fields.
- **Success:** Redirect to `/iniciar-sesion`.
- **Response:** Redirect.

### `POST /api/auth/recovery`

- **Purpose:** Request a password-recovery email.
- **Authentication:** Public route.
- **Input:** Form data: `email`.
- **Rules:** Uses an absolute `/auth/confirmar` callback. The neutral response does not reveal whether an account exists.
- **Success or handled failure:** Redirect to the recovery page with a Spanish message.
- **Response:** Redirect.

### `POST /api/auth/password`

- **Purpose:** Set a password after a verified invitation or recovery callback.
- **Authentication:** Verified, active authenticated session required.
- **Input:** Form data: `password`, `password_confirm`.
- **Rules:** Values must match and contain at least eight characters. The update uses `supabase.auth.updateUser`, not Auth Admin.
- **Success:** Redirect to `/dashboard`.
- **Failure:** Safe redirect to `/configurar-contrasena` with a Spanish error.
- **Response:** Redirect.

## Reports

### `POST /api/reports`

- **Purpose:** Create a production report draft.
- **Authentication:** Authenticated `OPERATOR`.
- **Input:** Form data: `machine_id`; optional `report_date`.
- **Rules:** The machine must be active and assigned. Database rules enforce one draft per machine and no more than five drafts per operator.
- **Success:** Redirect to the new report detail page.
- **Response:** Redirect.

### `PATCH /api/reports/[id]`

- **Purpose:** Save editable report fields.
- **Authentication:** Authenticated user; effective write access is constrained by endpoint behavior and RLS.
- **Input:** JSON with a whitelist of report date/order, catalog references or client/product text, timing, targets, production values, manual performance values, and observations. Empty optional values are normalized to `null` where applicable.
- **Rules:** Ownership, draft/finalized behavior, immutable identity fields, and supported administrator corrections are database-enforced.
- **Success:** JSON with the saved result.
- **Response:** JSON.

### `POST /api/reports/[id]/submit`

- **Purpose:** Submit an owned draft.
- **Authentication:** Responsible `OPERATOR`.
- **Input:** No additional business payload.
- **Rules:** The report must be an owned `DRAFT`, have `ended_at`, and have no open downtime event.
- **Success:** JSON confirmation.
- **Response:** JSON.

### `POST /api/reports/[id]/cancel`

- **Purpose:** Cancel an owned draft.
- **Authentication:** Responsible `OPERATOR`.
- **Input:** JSON with required cancellation `reason`.
- **Rules:** The report must be an owned `DRAFT` with no open downtime event.
- **Success:** JSON confirmation.
- **Response:** JSON.

### `POST /api/reports/[id]/stops`

- **Purpose:** Start a downtime event.
- **Authentication:** `OPERATOR`; RLS limits access to an owned draft.
- **Input:** JSON: `stop_category_id`; optional `description`.
- **Rules:** Database triggers establish timestamps and responsible identity. Only one event may remain open, and events may not overlap.
- **Success:** JSON with HTTP `201`.
- **Response:** JSON.

### `POST /api/reports/[id]/stops/[stopId]/close`

- **Purpose:** Stop an open downtime event.
- **Authentication:** `OPERATOR`; RLS limits access to an owned draft.
- **Input:** No additional business payload.
- **Rules:** Closes the selected event using database-controlled timing and duration.
- **Success:** JSON confirmation.
- **Response:** JSON.

### `GET /api/reports/export`

- **Purpose:** Generate an Excel workbook from the caller's visible reports.
- **Authentication:** `ADMINISTRATOR` or `VIEWER`; `OPERATOR` receives `403`.
- **Input:** Query parameters for period (`day`, `week`, or `month` and its date), status, and active-stop filtering. With no filters, all reports visible through RLS are considered.
- **Rules:** Active-stop filtering takes precedence where applicable. The query remains RLS-constrained. Exports are rejected rather than silently truncated above 1,000 reports, 10,000 stop events, or the configured 4 MiB output limit.
- **Success:** `.xlsx` attachment generated with ExcelJS.
- **Failure:** Spanish text response with an appropriate HTTP status.
- **Response:** File or text error.

## Frequent Catalogs

### `POST /api/catalogs/frequent`

- **Purpose:** Save frequently used free-text client or product values.
- **Authentication:** `ADMINISTRATOR` or `OPERATOR`.
- **Input:** JSON: supported `catalog` (`clients` or `products`) and `name`.
- **Rules:** Uses the existing database RPC and normalized catalog integrity rules.
- **Success:** JSON response.
- **Response:** JSON.

## Administration

All routes in this section require an authenticated `ADMINISTRATOR`; middleware and endpoint checks are supplemented by database permissions.

### `POST /api/admin/catalogs/[catalog]`

- **Purpose:** Create, edit, deactivate, reactivate, or attempt deletion of `products`, `clients`, `lines`, or `dosifier_types`.
- **Input:** Form fields for the selected catalog, optional record ID, and operation intent.
- **Rules:** Normalized uniqueness includes inactive rows. Reactivation changes only active state. Historical foreign-key references can block deletion.
- **Response:** Redirect to the catalog page with Spanish flash state.

### `POST /api/admin/machines`

- **Purpose:** Manage machine records.
- **Input:** Form fields including `id`, `code`, `name`, `description`, and `active`, or an operation intent.
- **Rules:** Normalized code/name uniqueness applies. Reactivation preserves identity; reports block deletion and assignments are removed only when deletion is safe.
- **Response:** Redirect with Spanish flash state.

### `POST /api/admin/shifts`

- **Purpose:** Manage production shifts.
- **Input:** Form fields including `id`, `name`, `start_time`, `end_time`, and `active`, or an operation intent.
- **Rules:** Catalog uniqueness and historical reference protections apply.
- **Response:** Redirect with Spanish flash state.

### `POST /api/admin/stop-categories`

- **Purpose:** Manage downtime categories.
- **Input:** Form fields including `id`, numeric code, name, description, and active state, or an operation intent.
- **Rules:** Numeric codes and normalized names are unique, including inactive records; equivalent numeric codes such as `1` and `01` conflict.
- **Response:** Redirect with Spanish flash state.

### `POST /api/admin/users/invite`

- **Purpose:** Invite a new Auth user and initialize the application profile.
- **Input:** Form data: `email`, `full_name`, `role`.
- **Rules:** Auth users are searched with pagination and normalized email comparison. Existing active and formally retired identities receive distinct safe errors. Password setup remains user-owned.
- **Response:** Redirect to the users page with Spanish flash state.

### `POST /api/admin/users/[id]`

- **Purpose:** Edit, retire, or reactivate an existing user.
- **Input:** Form data may include name, email, job title, role, active state, machine IDs, and operation intent.
- **Rules:** Email changes preserve the Auth UUID and preflight duplicate ownership. Self-demotion and self-deactivation are blocked. Retirement bans Auth access and deactivates assignments; reactivation unbans the same identity and activates only explicitly selected machines for operators. It sends no invitation and performs no automatic password reset.
- **Response:** Redirect with safe Spanish flash state; raw Auth or database errors are not exposed.
