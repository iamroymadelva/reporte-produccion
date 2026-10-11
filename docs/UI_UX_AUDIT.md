# Auditoría UI/UX — Reporte de Producción

| Campo | Valor |
| --- | --- |
| Fecha | 2026-10-08 |
| Rama | `redesign/ui-ux` (línea base: commit `e4d59e2`) |
| Alcance | Frontend completo: layout, navegación, componentes Astro y React, estilos, iconografía, mensajes, modales, tablas, notificaciones |
| Referencia | Proyecto `MOKANADEV/barstock` (Next.js 16 + shadcn/ui `new-york`) |
| Evidencia de QA | [`UI_UX_QA.md`](UI_UX_QA.md) y capturas en [`qa/`](qa/) |

> Esta auditoría describe el estado inicial y el plan de corrección. Cada hallazgo se cierra
> solo con un cambio verificable en código, una prueba o captura y el veredicto GO del auditor.

---

## 1. Resumen ejecutivo

La plataforma ya tiene una identidad visual coherente: azul industrial, ámbar y Fira Sans/Code
(ver [`DESIGN.md`](../DESIGN.md)). shadcn/ui se introdujo a medias, y hoy conviven **tres formas
de construir la misma cosa**:

1. Clases CSS propias (`.button-primary`, `.field-control`, `.panel`, `.app-nav-link`).
2. Componentes shadcn en `src/components/ui`, de los cuales **7 de 13 no tienen importadores**.
3. Markup inline repetido en cada página: badges, mensajes, encabezados y SVG.

Esto produce las redundancias medidas en la §3, diferencias visuales sutiles entre vistas
(radios, tamaños de pill, pesos de título) y 5 tests rotos. El shell actual (sidebar hecho a
mano con estado en `localStorage`) funciona, pero no usa la primitiva `Sidebar` de shadcn. Por
eso le faltan los tooltips en modo ícono, la persistencia sin salto de layout, el atajo de
teclado y la barra inferior móvil, que son lo que da fluidez a barstock.

**Dirección:** normalizar todo sobre shadcn/ui (Radix + CVA + `cn`) y usar los componentes React
**renderizados estáticamente** desde Astro, sin hidratar salvo cuando hay interacción. Así habrá
una única implementación por patrón, y un shell estilo barstock con sidebar, campana, menú de
cuenta, modo oscuro y barra inferior.

---

## 2. Estructura

### 2.1 Arquitectura de la interfaz

```
BaseLayout.astro
├─ <head>: manifest, íconos, theme-color
├─ AppShell.tsx (client:load)       sidebar a mano + Sheet móvil + header + breadcrumb + cuenta
│   └─ NotificationCenter.tsx (bell) Popover, polling 30 s
├─ #main-content
│   ├─ ConnectionStatus.astro        banners de conectividad / SW (script vanilla)
│   └─ <slot/> páginas
├─ AdminDialogHost.tsx (client:load, solo ADMINISTRATOR)   monta <template> como Radix Dialog
└─ <script> interceptor global de submit (canSendMutation)
```

Directivas de hidratación: solo `client:load` (7 usos). No se usa `client:idle`,
`client:visible` ni `client:only`.

### 2.2 Inventario de componentes

| Tipo | Componente | Rol | Observación |
| --- | --- | --- | --- |
| Astro | `CatalogAdminPage` | Página de catálogo genérica (4 catálogos) | Su encabezado difiere de las páginas de administración propias |
| Astro | `AdminRecordModal`, `DestructiveAction`, `UserReactivateAction` | Modales vía `<template>` + `AdminDialogHost` | `<style>` muerto (`.admin-record-modal*`, `.user-reactivate-modal*`) |
| Astro | `AdminFlashMessage` | Mensaje ok/error con autocierre | Los errores desaparecen solos (6 s) |
| Astro | `AdminSearch`, `AdminStatusToggle`, `AdminReactivateAction` | Utilidades de administración | Correctas; SVG inline |
| Astro | `AdminActionIcon`, `AdminCategoryIcon` | Íconos SVG propios | Duplican lo que ofrece lucide |
| Astro | `ConnectionStatus` | Banners de red y de actualización | Script vanilla extenso |
| React | `AppShell` | Shell | No usa la primitiva `Sidebar` de shadcn |
| React | `NotificationCenter` | Campana y página de notificaciones | Bien conectada a la API; sin Skeleton ni ScrollArea |
| React | `ReportEditor` (950 líneas) | Editor de reporte | Mezcla presentación, validación y persistencia |
| React | `StopManager`, `StopEventsTable`, `StopSummary` | Paradas | `StopSummary` se usa sin hidratar en `[id].astro` |
| React | `PlatformModal` | Confirmaciones (AlertDialog) | Correcto |
| React | `OfflineDraftNotice` | Aviso de borrador local | Caja ámbar propia |
| ui/ | `alert-dialog`, `dialog`, `button`, `popover`, `sheet`, `dropdown-menu` | En uso | — |
| ui/ | `alert`, `badge`, `card`, `input`, `label`, `separator`, `table` | **Sin importadores** | Instalados pero no adoptados |

### 2.3 Modales: cuatro implementaciones

| Implementación | Base | Apertura | Problema |
| --- | --- | --- | --- |
| `PlatformModal.tsx` | AlertDialog controlado | Estado del padre | Ninguno relevante |
| `AdminRecordModal.astro` | `<template>` → Dialog | `[data-admin-modal-open]` | **Dos botones de cierre** (X de Radix + X del template) |
| `DestructiveAction.astro` | `<template>` → AlertDialog | `[data-modal-open]` | Descripción fija en el host |
| `UserReactivateAction.astro` | `<template>` → Dialog grande | `[data-user-reactivate-open]` | Doble cierre; estilos muertos |

`ui/dialog.tsx` anuncia el botón de cierre en inglés ("Close").

### 2.4 Scripts vanilla en `.astro`

| Archivo | Función |
| --- | --- |
| `BaseLayout.astro` | Interceptor global de `submit` POST con verificación de conectividad |
| `AdminFlashMessage.astro` | Cierre y autocierre; limpia `ok`/`error` de la URL |
| `AdminSearch.astro` | Filtro de filas con anuncio de resultados |
| `ConnectionStatus.astro` | Estados de red, registro del SW y aviso de nueva versión |
| `iniciar-sesion.astro` | Mostrar u ocultar contraseña |
| `reportes/[id].astro` | Actualiza los chips de parada al recibir `REPORT_STOPS_CHANGED` |

---

## 3. Redundancias medidas

| Patrón | Ocurrencias | Ubicaciones | Normalización |
| --- | --- | --- | --- |
| Badge de estado (ternario DRAFT/CANCELLED/SUBMITTED) | 5 | `dashboard.astro` ×2, `reportes/index.astro` ×2, `reportes/[id].astro` | `<StatusBadge>` sobre variantes de `ui/badge` |
| Cálculo `hasOpenStop` inline | 6 | `dashboard` ×2, `reportes/index` ×3, `[id]` | `hasActiveStop()` en `lib/report-status.ts`, reutilizando `isActiveStop` (que además excluye paradas canceladas) |
| Indicador "Parada activa / abierta / En operación" | 8 | `dashboard`, `reportes/index`, `[id]`, `StopManager` | `<StopIndicator>` |
| Encabezado de página | 3 variantes en 13 páginas | eyebrow + `page-title`; back link + `text-3xl`; folio mono | `<PageHeader>` |
| Mensajes ok/error inline | 6 páginas + 6 componentes | login, recuperación, dashboard, reportes… | sonner (`FlashToast`) para resultados; `ui/alert` para avisos persistentes |
| Botones (`.button-*`) y campos (`.field-*`) | Todas las vistas | `global.css` | `ui/button` (`buttonVariants`), `ui/input`, `ui/select`, `ui/label` |
| SVG inline | 7 archivos | flash, modales, reactivar, KPIs, login | `lucide-react` |
| Bloques `<style>` | 3 | `AdminRecordModal`, `UserReactivateAction` (muertos), `dashboard` | Utilidades Tailwind y `ui/card` |
| Render tabla + tarjetas móviles | 3 | `dashboard`, `reportes/index`, `StopEventsTable` | Se conserva el patrón, con `ui/table` |

---

## 4. Diseño

### 4.1 Color

- **Doble sistema de tokens:** escalas `brand-*`/`accent-*` en `@theme` y variables shadcn
  (`--primary`, `--border`…) en `:root`, sin relación explícita entre ambas.
- **Hex sueltos** fuera de los tokens: `.skip-link`, `.app-header` y `.app-nav-link*`
  (`global.css:80-87`) y `theme-color` en `BaseLayout`.
- Faltan las variables `--sidebar-*`, `--chart-*` y `--*-foreground`, que necesitan los
  componentes shadcn `sidebar` y `sonner`.
- **Sin modo oscuro.** Barstock lo resuelve con la clase `.dark` y un toggle en el menú de cuenta.
- El verde (`emerald`) está bien restringido a éxito; ámbar = en curso; rojo = cancelado; naranja = parada.

### 4.2 Suavidad de líneas: radios, bordes y sombras

- `--radius: 0.75rem`, pero hay radios mezclados sin escala: `rounded-lg` (botones), `rounded-xl`
  (paneles y modales), `rounded-full` (pills) y valores en px dentro de `<style>`.
- Los pills de estado tienen dos tamaños (`text-xs` en dashboard e índice, base en las tablas).
- Las sombras son coherentes (`shadow-sm` en paneles, `shadow-xl/2xl` en overlays), salvo la sombra
  `rgb(15 23 42 / .08)` escrita a mano en los KPI.
- **Animación:** las transiciones de color duran 150 ms, pero los overlays no tienen entrada ni
  salida porque `tw-animate-css` no se importa. Las clases `animate-in` de shadcn quedan sin efecto,
  y esa es la diferencia más visible con barstock.

### 4.3 Tipografía

- Fira Sans (interfaz) y Fira Code (folios, KPIs, numéricos), autoalojadas con `@fontsource`. Correcto para PWA.
- Títulos con tres pesos y tamaños distintos según la página (§3, encabezados).
- Cuerpo de 16 px en móvil; etiquetas de 14 px en semibold. Correcto.

### 4.4 Accesibilidad e interacción

| Aspecto | Estado |
| --- | --- |
| Foco visible | Correcto (`outline` 2 px `--ring`) |
| Salto a contenido | Presente (`.skip-link`) |
| `prefers-reduced-motion` | Respetado globalmente |
| Objetivos táctiles | ≥ 44 px en la navegación y las acciones de administración |
| Errores que desaparecen solos | **Incorrecto** (`AdminFlashMessage`, 6 s) |
| Idioma de los textos sr-only | **Mezclado** ("Close" en `ui/dialog`) |
| Tooltip en sidebar colapsado | **Ausente** (solo `title`) |

---

## 5. Comparación con barstock

| Elemento | barstock | reporte-produccion (inicial) | Decisión |
| --- | --- | --- | --- |
| Shell | `SidebarProvider` + `Sidebar collapsible="icon"` + `SidebarInset` | Sidebar propio con `localStorage` | **Adoptar** la primitiva shadcn `sidebar` |
| Navegación | `nav-config.ts` con grupos y roles; grupos `Collapsible` | Ítems escritos dentro del componente | **Adoptar** `nav-config.ts` + `navForRole()` |
| Estado del sidebar | Cookie `sidebar_state` leída en el servidor; Ctrl/Cmd+B | `localStorage` (salto de layout al hidratar) | **Adoptar** la cookie leída en `BaseLayout` |
| Menú de cuenta | `DropdownMenu` en `SidebarFooter`, con toggle de tema | Dropdown en el header | **Adoptar** `NavUser` en el footer |
| Móvil | Barra inferior + "Más" abre el sidebar en Sheet | Sheet con botón de menú | **Adoptar** `BottomNav` |
| Campana | Link con contador | Popover con lista y polling | **Conservar el nuestro (más completo)** y llevarlo a ScrollArea, Skeleton y Badge |
| Tema | `next-themes`, clase `.dark` | Solo claro | **Adoptar** la clase `.dark` con un script propio en `<head>` (sin `next-themes`, que es de Next) |
| Overlays | `tw-animate-css` (fade, zoom, slide) | Sin animación | **Adoptar** |
| Toasts | `sonner` | Cajas inline con autocierre | **Adoptar** `sonner` para resultados de acciones |
| Carga | `PageSpinner`, `Skeleton` en el sidebar | Sin estados de carga en la campana | **Adoptar** `Skeleton` |
| Navegación entre páginas | Router cliente de Next | Recarga completa (MPA) | **Equivalente en Astro:** `prefetch` + `ClientRouter` con shell persistente |

---

## 6. Hallazgos priorizados

| ID | Prioridad | Hallazgo | Corrección | Estado |
| --- | --- | --- | --- | --- |
| UX-01 | Alta | 5 tests de `operator-ui` fallan: buscan `<dialog>` y los modales son Radix | Usar selectores por rol (`[role="alertdialog"]`) | Resuelto ([QA](UI_UX_QA.md)) |
| UX-02 | Alta | Shell sin la primitiva `Sidebar`: sin tooltips en modo ícono, salto de layout al hidratar, sin atajo ni barra inferior | `shell/*` con la primitiva shadcn, cookie, `BottomNav` | Resuelto ([QA](UI_UX_QA.md)) |
| UX-03 | Alta | Overlays sin animación (`tw-animate-css` no importado) | Importar y verificar las transiciones de Dialog, Popover, Sheet y Dropdown | Resuelto ([QA](UI_UX_QA.md)) |
| UX-04 | Alta | Tres sistemas para el mismo componente (CSS propio, shadcn, inline) | Migrar a `ui/*`; eliminar `.button-*`, `.field-*`, `.app-nav-*` | Resuelto ([QA](UI_UX_QA.md)) |
| UX-05 | Media | 5 ternarios de estado + 6 `hasOpenStop` inconsistentes con `isActiveStop` | `StatusBadge`, `StopIndicator`, `lib/report-status.ts` | Resuelto ([QA](UI_UX_QA.md)) |
| UX-06 | Media | 3 variantes de encabezado de página | `PageHeader.astro` | Resuelto ([QA](UI_UX_QA.md)) |
| UX-07 | Media | Los errores se autocierran a los 6 s | Toast de error persistente con cierre manual | Resuelto ([QA](UI_UX_QA.md)) |
| UX-08 | Media | Doble botón de cierre en los diálogos de administración; "Close" en inglés | `showCloseButton={false}` en el host; texto en español | Resuelto ([QA](UI_UX_QA.md)) |
| UX-09 | Media | Sin modo oscuro | Tokens `.dark` + toggle en `NavUser`, sin parpadeo | Resuelto ([QA](UI_UX_QA.md)) |
| UX-10 | Media | Tokens duplicados y hex sueltos | Un solo juego de variables shadcn; `brand-*` como alias | Resuelto ([QA](UI_UX_QA.md)) |
| UX-11 | Media | La campana no muestra estado de carga | `Skeleton` + `ScrollArea` | Resuelto ([QA](UI_UX_QA.md)) |
| UX-12 | Baja | SVG inline en 7 archivos e íconos propios duplicados | `lucide-react` | Resuelto ([QA](UI_UX_QA.md)) |
| UX-13 | Baja | `<style>` muertos en 2 modales y `<style>` de KPI | Eliminar; `ui/card` | Resuelto ([QA](UI_UX_QA.md)) |
| UX-14 | Baja | Navegación MPA sin precarga | `prefetch` + `ClientRouter` (alternativa: solo `prefetch`) | Resuelto ([QA](UI_UX_QA.md)) |
| UX-15 | Baja | `ReportEditor.tsx` de 950 líneas | Fuera de alcance de este ciclo: solo se normalizan clases visuales; se divide en otro ciclo | Diferido |

Hallazgos de datos heredados del borrador anterior (conteos exactos del dashboard, paginación de
reportes, exportación completa, catálogos paginados): se abordaron en el commit `e4d59e2` y se
verifican en QA con `bun run db:test`.

---

## 7. Catálogo objetivo de componentes

| Capa | Componentes |
| --- | --- |
| Primitivas (`src/components/ui`) | `alert`, `alert-dialog`, `avatar`, `badge`, `breadcrumb`, `button`, `card`, `collapsible`, `dialog`, `dropdown-menu`, `input`, `label`, `popover`, `scroll-area`, `select`, `separator`, `sheet`, `sidebar`, `skeleton`, `sonner`, `switch`, `table`, `tabs`, `tooltip` |
| Shell (`src/components/shell`) | `AppShell`, `nav-config`, `NavUser`, `TopBar`, `BottomNav` |
| Notificaciones (`src/components/notifications`) | `NotificationBell`, `NotificationList` |
| Dominio | `StatusBadge`, `StopIndicator`, `PageHeader.astro`, `FlashToast`, `Toaster` |
| Utilidades | `lib/utils.ts` (`cn`), `lib/theme.ts`, `lib/report-status.ts`, `hooks/use-mobile.ts` |

**Reglas:**
- Las páginas Astro importan los componentes React de `ui/` **sin directiva `client:`** cuando
  son estáticos (badge, card, table, button como enlace).
- Solo se hidrata lo interactivo.
- Ningún componente define colores fuera de los tokens.

## 8. Criterios de salida

- `bun test`, `bun run build` y `bun run db:test` en verde.
- QA visual en 375, 768, 1024 y 1440 px, en modo claro y oscuro y con los tres roles; capturas en `docs/qa/after-*`.
- Hallazgos UX-01 a UX-14 en estado *Resuelto* con evidencia en `UI_UX_QA.md`.
- Veredicto **GO** del auditor.

---

## 9. Iteración 2 — paridad visual con barstock

Objetivo: copiar el estilo de barstock en todo excepto la paleta (azul/ámbar/semánticos propios).

| Área | Cambio |
| --- | --- |
| Tipografía | Fira Sans/Code reemplazadas por Geist / Geist Mono variables autoalojadas (`@fontsource-variable/*`); se eliminan `@fontsource/fira-*` |
| Tema | Alternar tema como ítem simple del menú de cuenta ("Modo claro" con Sun / "Modo oscuro" con Moon), no checkbox |
| Sidebar | Claro en modo claro (`#fafafa`, activo `bg-sidebar-accent`), azul marino en oscuro; sin indicadores ámbar; cabecera con Factory + "PLANTA" + nombre; pie con Button ghost + Avatar; "Cerrar sesión" en `text-destructive` |
| Barra superior / BottomNav | `bg-card/95 backdrop-blur gap-3`; insignia de campana estilo barstock; BottomNav sin barra superior ámbar, activo `text-primary` |
| Dashboard | KPI `Card rounded-2xl` sin `border-l-4`, ícono lucide desnudo coloreado semánticamente, valor `text-2xl font-bold`, subtítulo "Hoy · ver detalle"; enlace sigue cubriendo la tarjeta |
| Encabezados | `PageHeader` sin eyebrow (prop eliminada y usos retirados), H1 `text-xl lg:text-3xl`, back link sutil |
| Páginas | Contenedor `max-w-7xl space-y-6 px-4 py-4 sm:px-6 sm:py-6`; `Card` de páginas con `rounded-2xl`; títulos de sección `text-base font-semibold` |
| Botones | `rounded-md font-medium`; se conserva 44px/48px de altura táctil (única desviación) |
| Login y públicas | Réplica de barstock: degradado con tokens `--auth-*`, `shadow-2xl`, logo en cuadro `bg-primary`, `CardHeader/Content/Footer`, placeholders, enlace "¿Olvidaste tu contraseña?" |
| Contraste | Tokens nuevos con ratios en comentarios de `global.css` (sidebar claro/oscuro >= 7:1; degradado auth solo de fondo bajo Card opaca) |

Desviaciones: la insignia de la campana solo se muestra con notificaciones sin leer (barstock la muestra siempre, también en 0) porque
una prueba existente (`ui-shell.test.tsx`) fija ese comportamiento; los ítems de menú del sidebar usan `h-8` (tamaño por defecto del primitive).
