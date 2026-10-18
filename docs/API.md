# API Reference

This reference describes the internal HTTP routes implemented under `src/pages/api`. They support the server-rendered application and are not established as a public third-party API.

## Authorization Architecture

Protected requests use the cookie-backed Supabase SSR client. Middleware rejects unauthenticated protected API requests with JSON `401` responses and blocks role-inappropriate administration routes with `403`; endpoint checks add operation-specific rules. Queries and mutations remain subject to PostgreSQL RLS. The server-only admin client is used only where Supabase Auth Admin operations are required.

Form endpoints generally redirect with Spanish flash-message query parameters. Interactive report endpoints generally return JSON. Raw database messages observed on some report mutation error paths are implementation details and are **not** a stable API contract; clients must not depend on their wording.

## Authentication

### `POST /api/auth/login`

- **Purpose:** Sign in with a username and password. There is no email login, invitation or recovery flow.
- **Authentication:** Public route.
- **Input:** Form data: `username` (case-insensitive, normalised), `password`.
- **Rules:** The lockout functions run first: after 5 consecutive failures the username is locked for 15 minutes. Every failure (wrong password, unknown user, locked or inactive account) redirects with the same generic Spanish message ("Usuario o contraseña incorrectos") so account existence is not revealed. The username is resolved to its synthetic Auth email server-side and authenticated with `signInWithPassword`.
- **Success:** `303` to `/` (which dispatches by role) with the header `X-Offline-Enroll: 1`, so the browser can create the offline verifier.
- **Response:** Redirect.

### `GET /api/auth/session-info`

- **Purpose (Phase 8):** Identifies the online session so the browser can confirm the offline verifier after a login and revalidate on reconnection. Public route in the middleware only so it can answer 401 vs 403.
- **Response:** `200 { userId, username, fullName, role, active, offlineLoginWindow, serverTime }`; `401` without a session; `403 { code: "INACTIVE" }` for a valid session with an inactive profile. `Cache-Control: private, no-store`.

### `GET /api/offline/overview`

- **Purpose (Phase 8, FR-020):** Read-only summary for the offline consultation page: day KPIs (`DRAFT`, `SUBMITTED`, `CLOSED`, `CANCELLED`, `ACTIVE_STOP`, `OFF_SHIFT`) and the last 200 reports (folio, status, machine, operator, approver, off-shift flag, active stop, stops/changes summary) plus `fetchedAt`/`serverTime`.
- **Authentication:** ROOT, ADMINISTRATOR and VIEWER; OPERATOR gets 403, no session 401. Never cached.

### `POST /api/auth/logout`

- **Purpose:** End the current Supabase session.
- **Authentication:** Publicly routable; signs out any available session.
- **Input:** No application fields.
- **Success:** Redirect to `/iniciar-sesion`.
- **Response:** Redirect.

### `POST /api/auth/password`

- **Purpose:** Change the caller's own password.
- **Authentication:** Authenticated, active session.
- **Input:** Form data: `password`, `password_confirm` (equal, at least 8 characters).
- **Rules:** Uses `supabase.auth.updateUser`, not Auth Admin. Administrators reset other users' passwords with `POST /api/admin/users/[id]` (`intent=reset_password`).
- **Response:** Redirect with a Spanish flash message.

### `POST /api/account/preferences`

- **Purpose:** Save the caller's own display preference for the time format.
- **Authentication:** Authenticated, active session (any role). Same-origin only (`Origin` mismatch gives `403`).
- **Input:** JSON `{ "time_format": "24h" | "12h" }` (closed list).
- **Rules:** Stores `user_metadata.time_format` with `supabase.auth.updateUser({ data })` using the caller's own session (never the service role, so another user's metadata cannot be written). It is presentation only: it grants no privilege (roles live in `profiles`/RLS) and `handle_new_user` runs only on user creation. The browser also copies the value to IndexedDB (`meta`, key `timeFormat:<userId>`) so the date-time picker reads it offline.
- **Response:** `200 { ok: true, time_format }`; `400` invalid JSON; `401` no session; `403` foreign origin; `422` value outside the list; `500` Auth failure. `Cache-Control: private, no-store`.

## Reports

### `POST /api/reports`

- **Purpose:** Create a production report draft.
- **Authentication:** Authenticated `OPERATOR`.
- **Input:** Form data: `machine_id`; optional `started_at` (device time, ISO; defaults to the request time). The server resolves shift and operational date from it; `report_date` is ignored.
- **Rules:** The machine must be active and assigned to the operator for the resolved shift and date. Database rules enforce one active (`DRAFT`) report per machine and one per operator.
- **Success:** Redirect to the new report detail page.
- **Response:** Redirect.

### `PATCH /api/reports/[id]`

- **Purpose:** Save editable report fields.
- **Authentication:** The responsible `OPERATOR` while the report is an active `DRAFT`. Managers receive `403` (they must use `/correct`).
- **Input:** JSON with a whitelist of report date/order, catalog references or client/product text, timing, targets, production values, manual performance values, and observations. Empty optional values are normalized to `null` where applicable. Operator clients may include the reserved `_base_updated_at` field; it is a concurrency precondition and is never written to the report.
- **Rules:** Ownership, draft/finalized behavior, immutable identity fields, and supported administrator corrections are database-enforced.
- **Concurrency:** When an Operator supplies `_base_updated_at`, the update applies only to the owned `DRAFT` at that exact server version. A response-loss replay whose editable values already match returns `200` with `alreadyApplied: true`; a different current version returns `409 REPORT_CONFLICT`, and a finalized report returns `409 REPORT_NOT_DRAFT`. Existing clients without the field and Administrator corrections retain their prior behavior.
- **Success:** JSON with the saved result and authoritative `updated_at`.
- **Response:** JSON.

### `POST /api/reports/[id]/submit`

- **Purpose:** Submit an owned draft.
- **Authentication:** Responsible `OPERATOR`.
- **Input:** No additional business payload.
- **Rules:** The report must be an owned `DRAFT`, have no active downtime event, and have all Operator inputs complete. Required fields are date, product text, production order, line, client text, lot, shift, weight, g/min, dosifier, start/end, programmed hours, units and waste. Observations is optional; numeric zeros are valid. Missing/invalid fields return `400` with `fieldErrors`; an active stop returns `409`. The database independently enforces required inputs and serializes stop mutations against finalization.
- **Success:** JSON confirmation.
- **Response:** JSON.

### `POST /api/reports/[id]/cancel`

- **Purpose:** Cancel an active report.
- **Authentication:** The responsible `OPERATOR` (own `DRAFT`, at any time), or a manager (`ROOT`/`ADMINISTRATOR`) **only** when the report is off-shift (still active more than `app_settings.off_shift_grace`, 2 h by default, after its shift ended). Auditors cannot cancel, and submitted or closed reports cannot be cancelled by any role.
- **Input:** JSON with a required cancellation `reason`.
- **Rules:** Calls `cancel_report`; an operator needs no open stop, and a manager's cancellation also cancels the open stops. Errors: `409 NOT_CANCELLABLE`, `403`.
- **Success:** JSON confirmation.

### `POST /api/reports/[id]/approve`

- **Purpose:** "Aprobar y cerrar": `SUBMITTED` -> `CLOSED` recording approver and time.
- **Authentication:** Manager.
- **Rules:** `approve_report`: `409 NOT_SUBMITTED` if the report is not submitted, `409 OPEN_CONFLICT` while a `sync_quarantine` item is open or a stop is open or uncategorised. Requires connectivity.
- **Success:** JSON with the updated report.

### `POST /api/reports/[id]/correct`

- **Purpose:** Correct a `SUBMITTED` or `CLOSED` report with an auditable reason.
- **Authentication:** Manager (an active report cannot be corrected; `PATCH` by a manager is `403`).
- **Input:** JSON `{ patch: {...fields}, stops?: [...], changes?: [...], reason }`; `reason` is trimmed and must have at least 5 characters (`400` otherwise). Unknown report fields are rejected with `400`; the column whitelist is validated again by `correct_report`.
- **Rules:** Every changed field is written to `report_audit_log` with old and new value, actor, role and reason. `NOT_CORRECTABLE` is returned as `409`.

### `POST /api/reports/[id]/changes`

- **Purpose:** Register a production change (product, format, lot, other) in the operator's own active report.
- **Authentication:** Responsible `OPERATOR`.
- **Input:** JSON `{ id: uuid, change_type_id, description (1-500 chars), occurred_at }`; `occurred_at` is the device time.

### `GET /api/reports/[id]/timeline`

- **Purpose:** Report detail plus the chronological (ascending) audit history, used by the live detail view.
- **Authentication:** Managers, auditors and the report's author (RLS decides what is visible). Never cached.

### `POST /api/sync-quarantine/[id]/review`

- **Purpose:** Review an offline-capture conflict item.
- **Authentication:** Manager.
- **Input:** JSON `{ apply?: boolean, reason?: string }`. Without `apply` the item is marked `REVIEWED` and the server value is kept; with `apply: true` the data is applied through `correct_report` and `reason` needs at least 5 characters (only `SUBMITTED`/`CLOSED` reports, otherwise `NOT_CORRECTABLE`). `ALREADY_REVIEWED` and `NOT_FOUND` are reported as errors.

### `POST /api/reports/[id]/stops`

- **Purpose:** Start a downtime event.
- **Authentication:** `OPERATOR`; RLS limits access to an owned draft.
- **Input:** JSON: optional `id` (client uuid), optional `stop_category_id` (it may be chosen later but is required to close), optional `description` and device `started_at`.
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

Cancelled stops remain in the detail sheet with their reason and are excluded from durations and category totals.

- **Purpose:** Generate an Excel workbook from the caller's visible reports.
- **Authentication:** `ROOT`, `ADMINISTRATOR` or `VIEWER`; `OPERATOR` receives `403`.
- **Input:** Query `from`, `to` (operational date), `machine`, `shift`, `operator`, `status` (`DRAFT`, `SUBMITTED`, `CLOSED`, `CANCELLED`), `stop=active`, `offshift=1`. The legacy `period`/`date`/`month` parameters are translated to `from`/`to`.
- **Rules:** The query remains RLS-constrained and uses exactly the same filters as the list. Sheets: SEGUIMIENTO PRODUCCIÓN, DETALLE PARADAS, CAMBIOS, HISTORIAL, CATÁLOGO PARADAS, with approver and approval-time columns. Exports are rejected rather than silently truncated above 1,000 reports, 10,000 stop events, 50,000 history rows or the 4 MiB output limit.
- **Success:** `.xlsx` attachment generated with ExcelJS. **`204`** when no report matches (the UI shows "No hay reportes…" and offers no download).
- **Failure:** Spanish text response with an appropriate HTTP status (`400` invalid filter, `403`, `413`/`422` limits).

### `PATCH /api/reports/[id]/stops/[stopId]/category`

- **Authentication:** Responsible `OPERATOR` with an owned editable `DRAFT` and an active stop.
- **Input:** JSON `stop_category_id`, referencing an active category.
- **Rules:** Changes category without changing start time; audited in `report_audit_log`.
- **Response:** JSON `{ ok, stop }` with the authoritative event and category; `409` if no longer editable.

### `POST /api/reports/[id]/stops/[stopId]/cancel`

- **Authentication:** Responsible `OPERATOR` with an owned editable `DRAFT` and an active stop.
- **Input:** Required, non-whitespace string `reason`.
- **Rules:** The database stamps `cancelled_at`, `cancelled_by`, and `ended_at`, stores the trimmed reason, and sets duration to `NULL`. The row remains readable and is audited. Operators cannot mutate or delete closed/cancelled stops. Administrator correction permissions remain available through the existing database model.
- **Response:** JSON `{ ok, stop }`; `400` for empty reason; `409` if no longer editable.

All stop mutations require connectivity and return the full event selection used by the history. The client does not queue or replay them, or supply authoritative elapsed durations. Closing a stop returns `409` if already closed, cancelled, or inaccessible.

## Administration

All routes in this section require an authenticated `ROOT` or `ADMINISTRATOR` (coordinators manage only operators); middleware and endpoint checks are supplemented by database permissions.

### `POST /api/admin/catalogs/[catalog]`

- **Purpose:** Create, edit, deactivate, reactivate, or attempt deletion of `products`, `clients`, `lines`, or `dosifier_types`.
- **Input:** Form fields for the selected catalog, optional record ID, and operation intent.
- **Rules:** Normalized uniqueness includes inactive rows. Reactivation changes only active state. Historical foreign-key references can block deletion.
- **Response:** Redirect to the catalog page with Spanish flash state.

### `POST /api/admin/machines`

- **Purpose:** Manage machine records.
- **Input:** Form fields including `id`, `code`, `name`, `description`, `location` (optional, trimmed, empty = none, max 120 characters) and `active`, or an operation intent. Requires ROOT or coordinator (401 without session, 403 otherwise).
- **Rules:** A location longer than 120 characters is rejected with a Spanish flash message ("La ubicación no puede superar 120 caracteres.") and nothing is written. Normalized code/name uniqueness applies. Reactivation preserves identity; reports block deletion and assignments are removed only when deletion is safe.
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

### `POST /api/admin/users`

- **Purpose:** Create a user (replaces the removed `/api/admin/users/invite`).
- **Input:** Form data: `username` (`^[a-z0-9._-]{3,32}$`, lowercased, immutable), `full_name`, `job_title?`, `role`, `password` (>= 8), `password_confirm`, `assignments[]` (`machine_id:shift_id`), optional `valid_from` / `valid_to`.
- **Rules:** ROOT may create any role; a coordinator (ADMINISTRATOR) only OPERATOR (other roles: 403 JSON). Creates the Auth user with the synthetic email `<username>@usuarios.reporte-produccion.invalid` (`email_confirm`), then calls `manage_user_assignments` (audit `USER_CREATED`); the Auth user is deleted if the RPC fails. A duplicate username, including a retired one, gets a safe error.
- **Response:** Redirect to the users page with Spanish flash state.

### `POST /api/admin/users/[id]`

- **Purpose:** Update, reset the password of, retire, or reactivate an existing user (`intent` = `update` (default), `reset_password`, `remove`, `reactivate`).
- **Input:** Form data: `full_name`, `job_title`, `role`, `active`, `assignments[]`, `valid_from` / `valid_to`, `password` + `password_confirm` (reset), `confirm_offline_risk=1`, `force_reason` (ROOT only: forces the deactivation despite pending data; a coordinator sending it gets `403`).
- **Rules:** Management matrix enforced before any data change (ROOT manages every role; a coordinator only OPERATOR targets and only the OPERATOR role). The email is no longer editable. Self-demotion and self-deactivation are blocked. `remove` and `update` with `active` off require `confirm_offline_risk=1`; `USER_HAS_PENDING_DATA` (draft report or pending offline records) is translated to a Spanish message. Password reset audits `PASSWORD_RESET` without storing the password.
- **Response:** Redirect with safe Spanish flash state; raw Auth or database errors are not exposed.

### `GET /api/admin/users/[id]/last-contact`

- **Purpose:** Data for the retire/deactivate confirmation (FR-005a): `{ lastSeenAt, pendingCount, activeReportId }` from `user_last_contact`. Managers only, according to the matrix (403 otherwise).

### `POST /api/offline/login-audit`

- **Phase 8 (FR-006c):** records an offline sign-in made on a device. JSON `{ operationId, startedAt }`; any authenticated active role; the actor is always the session user (`public.record_offline_login`, `administrative_audit_log` action `OFFLINE_LOGIN`). Idempotent by `operationId`; same `startedAt` -> `duplicate`; max 20 per user per hour (429); future time -> 422; foreign `operationId` -> 403. `session-info` also returns `signInAt` (last_sign_in_at).

### `POST /api/device-status`

- **Purpose:** A device reports its pending offline records. JSON `{ deviceId, pendingCount, oldestPendingAt? }` -> `report_device_sync_status` for the caller only. Response 204.

## Admin audit, dashboard and change types

### `GET /api/admin/audit`

- **Purpose:** Paginated administrative history (page `/administracion/historial`).
- **Authentication:** `ROOT` only (middleware and endpoint); coordinators, operators and auditors receive `403`.
- **Input:** Query `from`, `to`, `actor`, `action`, `entity_type`, `page`.
- **Response:** JSON page of `administrative_audit_log` rows (actor, role, action, entity, old/new value, details, time).

### `POST /api/admin/change-types`

- **Purpose:** Manage the change-type catalog (Producto, Formato, Lote, Otro, ...). Same contract as the other catalog routes; `intent=delete` deletes unused rows and deactivates rows in use.

### `GET /api/dashboard/summary`

- **Purpose:** Live dashboard data: KPIs by status for a range, machines currently stopped, off-shift active reports, open sync conflicts, recent reports and the active operators (for the presence list).
- **Authentication:** Managers and `VIEWER`; `OPERATOR` -> `403`, no session -> `401`. Everything is queried with the user's session, so RLS decides what is visible.
- **Input:** Query `from`, `to` (operational date `AAAA-MM-DD`; both default to today).
- **Rules:** An invalid date, or `from` after `to`, gives `422`; a range longer than **366 days** (inclusive) also gives `422` ("El rango de fechas es demasiado amplio…"). `Cache-Control: private, no-store`.

## Offline synchronisation

### `GET /api/offline/snapshot`

- **Purpose:** Work snapshot for the operator's offline shift: profile, settings (`offShiftGrace`, `offlineLoginWindow`), shifts, current assignments (each machine includes its optional `location`), active catalogs and the active report with its stops and changes, plus `serverTime`.
- **Authentication:** `OPERATOR`. Never cached.

### `POST /api/sync/batch`

- **Purpose:** Upload confirmed pending operations (see `specs/001-offline-production-reports/contracts/sync-protocol.md`).
- **Authentication:** An active `OPERATOR`; operations always run as the session user (`403` otherwise).
- **Input:** JSON with between 1 and 50 operations, each with a unique integer `seq`, a client `operationId`, a type (`CREATE_REPORT`, `SAVE_REPORT_FIELDS`, `START_STOP`, `CLOSE_STOP`, `SET_STOP_CATEGORY`, `CANCEL_STOP`, `ADD_CHANGE`, `SUBMIT_REPORT`, `CANCEL_REPORT`) and the device capture time. Larger batches get `413`; malformed operations `400`.
- **Rules:** Operations are applied in `seq` order through `apply_sync_operation`; a failed `CREATE_REPORT` rejects its dependent operations (`DEPENDENCY_FAILED`). Each result is `applied`, `duplicate` (same `operationId` replayed), `conflict` or `rejected`, with a code and a Spanish message. Data that cannot be applied is stored in `sync_quarantine`.
- **Response:** JSON `{ results: [...one per operation], serverTime }`; `401` keeps everything pending on the device.

### Other offline routes

`POST /api/device-status`, `POST /api/offline/login-audit`, `GET /api/auth/session-info` and `GET /api/offline/overview` are documented above.

### `HEAD /api/health`

- **Purpose:** Same-origin connectivity probe: `204` with `X-Server-Time` (the server clock, used to bind the offline enrollment to a real login). Public and never cached.

## Notifications

- `GET /api/notifications`: the caller's notifications (paginated) and unread count.
- `PATCH /api/notifications/[id]`: mark one notification read.
- `POST /api/notifications/read-all`: mark all of the caller's notifications read.

Types include the original stop, submit and cancel events plus `SYNC_CONFLICT`, `OFFLINE_DATA_REVIEW`, `CLOCK_SKEW_REVIEW` and `REPORT_APPROVED`.

## Removed routes

`POST /api/auth/recovery`, `/recuperar-contrasena`, `/auth/confirmar`, `POST /api/admin/users/invite` and `POST /api/catalogs/frequent` no longer exist (404).
