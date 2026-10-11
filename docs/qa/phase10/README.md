# QA Fase 10 — accesibilidad y móvil (375 px)

Chrome 154 real (headless, DevTools Protocol), viewport 375x812 móvil, contra `astro dev` y Supabase locales, con sesiones reales de `op1`, `coord1`, `auditor1` y `root`.

| Archivo | Contenido |
| --- | --- |
| `audit-375.json` | Por pantalla: desbordamiento horizontal, nº de `h1`, controles sin etiqueta, botones/enlaces sin nombre accesible, objetivos táctiles < 40 px, regiones en vivo. |
| `*.png` | Capturas: login, acceso-offline, /turno (claro y oscuro), dashboard, reportes, consulta-offline, usuarios, historial administrativo y detalle de reporte (coordinador y auditor). |

Resultado: ninguna pantalla desborda horizontalmente; un `h1` por pantalla; sin controles sin etiqueta ni botones sin nombre. Restan 5 enlaces de KPI (37 px, pero la tarjeta completa es el área de clic) y 2 casillas nativas de 16 px dentro de etiquetas de 44 px. Tras las capturas se añadió `mb-5` a las tarjetas de `ApprovalPanel` (separación con la tarjeta siguiente); ese último ajuste no se volvió a capturar.

No cubre: tableta ni lector de pantalla reales, contraste medido con herramienta WCAG (solo revisión visual en claro y oscuro), ni modo sin conexión en un navegador real.
