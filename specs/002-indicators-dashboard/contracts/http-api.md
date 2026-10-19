# Contratos: Indicadores

## HTTP — `GET /api/indicadores?rango=7d|30d|90d`

Autenticación por cookies de sesión. Todas las respuestas llevan `Cache-Control: private, no-store`.

| Caso | Estado | Cuerpo |
|---|---|---|
| Sin sesión | 401 | `{ "error": "Debes iniciar sesión." }` |
| Rol `OPERATOR` (u otro no permitido) | 403 | `{ "error": "Los indicadores son solo para coordinadores y auditores." }` — sin consultar la base |
| `rango` ausente, vacío o distinto de `7d`, `30d`, `90d` (sensible a mayúsculas) | 422 | `{ "error": "El rango no es válido: usa 7d, 30d o 90d." }` |
| Error de la función/base | 500 | `{ "error": "No fue posible cargar los indicadores." }` (detalle solo en `console.error`) |
| OK (`ROOT`, `ADMINISTRATOR`, `VIEWER`) | 200 | Objeto de abajo |

Roles permitidos: `ROOT`, `ADMINISTRATOR`, `VIEWER`. La ruta valida el rol aunque el middleware ya lo filtre.

### Respuesta 200

```json
{
  "range": { "key": "30d", "from": "2026-09-20", "to": "2026-10-19", "days": 30 },
  "cards": {
    "reports": 42,
    "approved": 31,
    "approvedRatio": 0.738,
    "avgApprovalSeconds": 45360,
    "stopSeconds": 190800
  },
  "daily": [{ "date": "2026-09-20", "seconds": 5400 }],
  "machines": [{ "machineId": "uuid", "code": "M-02", "name": "Empacadora 2", "seconds": 61200 }],
  "categories": [
    { "kind": "category", "categoryId": "uuid", "name": "Mecánica", "seconds": 72000 },
    { "kind": "uncategorized", "categoryId": null, "name": null, "seconds": 3600 },
    { "kind": "other", "categoryId": null, "name": null, "seconds": 9000 }
  ],
  "serverTime": "2026-10-19T15:04:05.000Z"
}
```

Reglas del contrato:

- `range.from`/`to` son fechas operativas (`AAAA-MM-DD`, Bogotá), calculadas en el servidor; `to` = hoy incluido; `days` ∈ {7, 30, 90}.
- Todas las magnitudes de tiempo van en **segundos** enteros; la UI convierte a horas (1 decimal).
- `approvedRatio`: `approved / reports` en [0, 1]; `null` si `reports = 0`.
- `avgApprovalSeconds`: `null` si no hay reportes aprobados con turno resoluble.
- `daily`: exactamente `days` elementos, ordenados por fecha ascendente, con `seconds = 0` en días sin paradas.
- `machines`: ≤ 10, ordenadas por `seconds` descendente (desempate por `code`), solo `seconds > 0`.
- `categories`: ≤ 6, `seconds > 0`, ordenadas descendente con `other` al final; la suma es igual a `cards.stopSeconds`. `name` es `null` para `uncategorized` y `other` (el texto «Sin categoría» / «Otras» lo pone la interfaz).
- `daily` suma `cards.stopSeconds`.

## RPC — `public.indicators_summary(p_from date, p_to date) returns jsonb`

Devuelve el mismo objeto sin `range.key` ni `serverTime` (los agrega el endpoint): `{ range: {from, to, days}, cards, daily, machines, categories }`.

| Condición | Resultado |
|---|---|
| Llamador `OPERATOR` o sin perfil activo | `ERROR 42501` (`insufficient_privilege`) |
| `anon` | sin `execute` |
| `p_from > p_to` o rango > 366 días | `ERROR 22023` |
| Manager o `VIEWER` | JSON; los datos respetan las políticas RLS del llamador (`security invoker`) |

## UI

- Ruta `/indicadores` (SSR, no prerenderizada, no entra al service worker); isla `IndicatorsDashboard` (`client:load`).
- Ítem de navegación «Indicadores» para `ROOT`, `ADMINISTRATOR`, `VIEWER` (grupo Operación). Operarios no lo ven y reciben redirección a `/reportes` si abren la URL.
