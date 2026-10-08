# Auditoría UI/UX — Reporte de Producción

Fecha: 2026-10-08. Alcance: código local de Astro SSR, React, Tailwind, Supabase, PWA y rutas de autenticación, operación y administración. Estado: auditoría inicial; la evidencia visual y las verificaciones finales se registran en `UI_UX_QA.md`.

## Inventario

| Capa | Estado inicial | Decisión |
| --- | --- | --- |
| Framework | Astro 7 SSR con adaptador Vercel, React 19 en islas | Conservar SSR y React; integrar shadcn/ui en las islas interactivas. |
| Estilos | Tailwind 4, `global.css`, clases reutilizables y Fira Sans/Code | Mantener identidad azul/ámbar e introducir tokens semánticos. |
| Datos | Supabase Auth, PostgREST y RLS; formularios POST de Astro | Mantener autorización en servidor y migrar avisos con RLS. |
| Estado local | IndexedDB para borradores, service worker para recursos públicos | Preservar borradores y evitar caché de respuestas autenticadas. |
| Vistas | Login, recuperación, dashboard, reportes, editor, paradas, ocho áreas administrativas | Revisar responsive, teclado, foco, estados y consistencia. |

## Hallazgos priorizados

| Prioridad | Hallazgo y evidencia en código | Impacto | Corrección prevista | Estado |
| --- | --- | --- | --- | --- |
| Alta | `dashboard.astro` consulta todos los reportes del día y enlaza KPIs sin fecha. | Conteos expuestos a límite implícito de PostgREST; destino no corresponde al indicador. | Conteos exactos y enlaces con `period=day` y fecha Bogotá. | Pendiente |
| Alta | `reportes/index.astro` lee todos los reportes y repite consulta al filtrar. | Truncado silencioso, trabajo duplicado y ausencia de páginas. | Paginación en servidor con total exacto, 25 filas y orden estable; borradores aparte. | Pendiente |
| Alta | Exportación limita 1000 reportes y 10000 paradas. | Períodos amplios no se exportan y puede haber discrepancias con listado. | Recorrer páginas completas y controlar fallos explícitamente. | Pendiente |
| Alta | Administración obtiene catálogos completos sin paginación y `AdminSearch` solo filtra filas renderizadas. | Búsquedas parciales al superar límite de API; no anuncia resultados. | Cargar conjuntos completos de manera paginada y anunciar resultados. | Pendiente |
| Alta | No existen persistencia ni interfaz de notificaciones. | Usuarios no reciben avisos de transiciones y asignaciones. | Eventos transaccionales, entregas por usuario, bandeja y campana. | Pendiente |
| Media | `BaseLayout.astro` solo ofrece barra superior, menú móvil propio y no tiene salto a contenido. | Navegación inconsistente y mayor esfuerzo con teclado. | Sidebar adaptable, breadcrumbs, cuenta y salto a contenido. | Pendiente |
| Media | `AdminRecordModal`, `DestructiveAction`, `PlatformModal` y acciones de usuario contienen patrones de modal separados. | Foco, cierre y diseño se comportan distinto. | Consolidar diálogos con primitivas shadcn/Radix en las islas y un patrón accesible para formularios Astro. | Pendiente |
| Media | `ReportEditor.tsx` agrupa presentación, validación, guardado y recuperación en un archivo grande. | Cambios visuales arriesgan lógica de guardado. | Separar subcomponentes visuales y mantener coordinación de datos. | Pendiente |
| Media | `AdminFlashMessage.astro` elimina errores después de seis segundos. | El mensaje puede desaparecer antes de ser entendido. | Mantener error hasta cierre manual o resolución. | Pendiente |
| Media | Faltan estados vacíos específicos, etiquetas de orden y pruebas de foco en varias tablas. | Usuarios no distinguen fallo, vacío y carga ni el orden de filas. | Estados explícitos y semántica accesible. | Pendiente |

## Criterios de salida

Se considerará resuelto cada hallazgo cuando exista cambio verificable en código, prueba apropiada y evidencia de QA. La auditoría independiente final corresponde a GPT-6 Astra; este documento no constituye aprobación.
