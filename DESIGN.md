# DESIGN.md — Sistema de diseño de Reporte de Producción

Fuente de verdad visual de la aplicación. Generado a partir de **UI/UX Pro Max**
(`.claude/skills/ui-ux-pro-max`) con la consulta:

```bash
uv run --no-project --python 3.12 .claude/skills/ui-ux-pro-max/scripts/search.py \
  "manufacturing production reporting dashboard industrial operations data-dense" \
  --design-system -p "Reporte de Produccion" -f markdown
```

Los tokens viven en [`src/styles/global.css`](src/styles/global.css) (bloque `@theme`). Ningún
componente debe usar valores hexadecimales sueltos ni la paleta `emerald` como color de marca.

---

## 1. Dirección

| Aspecto | Decisión |
| --- | --- |
| Producto | Herramienta operativa interna de planta (manufactura y empaque) |
| Patrón | **Data-Dense + Drill-Down**: indicadores arriba, tablas filtrables, detalle por reporte |
| Estilo | **Data-Dense Dashboard**: grillas, KPIs, tablas, bordes nítidos, cero ornamento |
| Tono | Industrial, preciso, confiable. Azul de ingeniería + ámbar de señalización |
| Usuarios | Operarios en tablet/teléfono en planta (guantes, luz variable), administradores en escritorio |
| Anti‑patrones | Diseño ornamental, gradientes decorativos, emojis como íconos, tablas sin filtro |

## 2. Color

### Marca (`brand`, escala azul industrial)

| Token | Hex | Uso |
| --- | --- | --- |
| `brand-50` | `#EFF6FF` | Fondo de ítem seleccionado, chips activos |
| `brand-100` | `#DBEAFE` | Anillo de íconos, hover suave |
| `brand-600` | `#2563EB` | Anillo de foco, borde de campo enfocado |
| `brand-700` | `#1D4ED8` | Enlaces y texto de acción (6.7:1 sobre blanco) |
| `brand-800` | `#1E40AF` | **Primario**: botones principales (8.7:1 con texto blanco) |
| `brand-900` | `#1E3A8A` | Hover de primario, títulos de marca |
| `brand-950` | `#172554` | Barra de navegación, `theme-color` |

### Acento (`accent`, ámbar de señalización)

| Token | Hex | Uso |
| --- | --- | --- |
| `accent-400` | `#FBBF24` | Indicador de navegación activa sobre `brand-950` |
| `accent-500` | `#F59E0B` | CTA de creación (`.button-accent`) con texto `slate-950` (8.3:1) |

> El ámbar **nunca** lleva texto blanco (contraste 2.1:1). Siempre texto `slate-950`.

### Superficies y texto

| Rol | Valor |
| --- | --- |
| Fondo de página | `slate-50` `#F8FAFC` |
| Superficie (panel, tabla) | `white` + borde `slate-200` |
| Texto principal | `slate-900` `#0F172A` |
| Texto secundario | `slate-600` `#475569` (mínimo permitido para cuerpo) |
| Texto terciario / etiquetas | `slate-500` solo en ≥ 12px seminegrita o metadatos |

### Semánticos (estado del reporte)

| Estado | Badge | Significado |
| --- | --- | --- |
| En curso (`DRAFT`) | `amber-100` / `amber-900` | Reporte abierto, editable |
| Enviado (`SUBMITTED`) | `emerald-100` / `emerald-800` | Éxito, cerrado |
| Cancelado (`CANCELLED`) | `red-100` / `red-800` | Anulado |
| Parada activa | `orange-100` / `orange-800` + punto | Máquina detenida |

`emerald` queda reservado **exclusivamente** para éxito (enviado, activo, conexión
restablecida, mensajes `ok`). El color nunca es el único indicador: todo estado lleva texto.

## 3. Tipografía

| Rol | Fuente | Pesos |
| --- | --- | --- |
| Interfaz y títulos | **Fira Sans** | 400, 500, 600, 700 |
| Datos numéricos, folios, KPIs, códigos de máquina | **Fira Code** (`font-mono`) | 500, 600 |

Las fuentes se sirven localmente con `@fontsource` (subconjunto latino), no desde Google
Fonts: la app es PWA con soporte sin conexión y el service worker cachea `/_astro/`.

> Desviación consciente de UI/UX Pro Max: la herramienta sugiere Fira Code para títulos.
> Aquí se reserva para cifras y folios (donde aporta alineación tabular) y los títulos usan
> Fira Sans, más legible en español con acentos y en pantallas pequeñas.

| Escala | Clase | Uso |
| --- | --- | --- |
| Eyebrow | `.eyebrow` (12px, 600, mayúsculas, `tracking-wider`, `brand-700`) | Contexto sobre el H1 |
| H1 | `text-2xl sm:text-3xl font-bold tracking-tight` | Título de página |
| H2 | `text-lg font-semibold` | Título de sección / panel |
| Cuerpo | 16px, `leading-relaxed` | Mínimo 16px en móvil |
| KPI | `font-mono text-3xl font-semibold tabular-nums` | Indicadores |

## 4. Espaciado, forma y elevación

- Escala base de 4px (Tailwind). Contenedor: `max-w-7xl`, gutter `px-4 sm:px-6`.
- Radios: controles y botones `rounded-lg` (8px); paneles `rounded-xl` (12px); badges `rounded-full`.
- Elevación: una sola sombra (`shadow-sm`) para paneles; `shadow-xl` solo para modales y avisos flotantes.
- Bordes de 1px `slate-200` separan; no usar sombras para separar filas.

## 5. Componentes (clases en `global.css`)

| Clase | Descripción |
| --- | --- |
| `.button-primary` | Fondo `brand-800`, texto blanco, alto 48px |
| `.button-accent` | Fondo `accent-500`, texto `slate-950`. **Un solo uso por vista** (crear reporte) |
| `.button-secondary` | Blanco, borde `slate-300`; estado activo con `aria-current`/`.is-active` |
| `.button-danger` | Fondo `red-700`, texto blanco |
| `.field-label` / `.field-control` | Etiqueta siempre visible; foco `brand-600` con anillo `brand-100` |
| `.panel` | Superficie blanca, borde `slate-200`, `rounded-xl`, `shadow-sm` |
| `.eyebrow` | Rótulo superior de página |
| `.link` | Enlace de acción `brand-700`, subrayado en hover |
| `.data-table` | Encabezado `slate-50` en mayúsculas 12px, filas con hover `slate-50` |
| `.kpi-card` | Panel blanco con franja izquierda de 4px del color semántico |

## 6. Navegación

- Barra superior `brand-950` con texto blanco; el ítem activo se marca con barra inferior
  ámbar de 3px y `aria-current="page"` (no solo color).
- Móvil (< 640px): botón "Menú" de 44px que despliega un panel con usuario, rol y enlaces.

## 7. Responsividad

Breakpoints verificados: **375px, 768px, 1024px, 1440px**.

| Ancho | Comportamiento |
| --- | --- |
| < 640px | Una columna; tablas de administración se convierten en tarjetas (`.responsive-admin-table`); listas de reportes usan `.mobile-card-list` |
| 640–1023px | KPIs en 2 columnas; tablas anchas con desplazamiento horizontal dentro de `role="region"` enfocable |
| ≥ 1024px | KPIs en 4 columnas; tablas completas |

Reglas: sin scroll horizontal de página (`overflow-x: clip` en `body`), respetar
`env(safe-area-inset-*)`, objetivos táctiles ≥ 44×44px con separación ≥ 8px.

## 8. Interacción y accesibilidad

- `cursor-pointer` en todo elemento clicable; transiciones de color de 150–200ms.
- Hover sin desplazamiento de layout (sin `scale`).
- Foco visible: contorno de 2px `brand-600` con `outline-offset: 2px`.
- `prefers-reduced-motion: reduce` desactiva transiciones y animaciones.
- Contraste mínimo 4.5:1 para texto; íconos SVG (trazo 2px, 24×24), nunca emojis.
- Botones asíncronos se deshabilitan y muestran el estado ("Comprobando conexión…").

## 9. Checklist previa a entrega

- [ ] Sin hex sueltos ni `emerald` como marca
- [ ] Badges de estado con texto, no solo color
- [ ] Foco visible y orden de tabulación lógico
- [ ] 375 / 768 / 1024 / 1440 sin scroll horizontal
- [ ] `prefers-reduced-motion` respetado
- [ ] `theme-color`, manifest y `offline.html` alineados con `brand-950`

## 10. Pendiente

- Los íconos PWA (`public/icons/*`) y `public/branding/` conservan la paleta verde anterior;
  regenerarlos en azul `brand-800` / ámbar cuando se apruebe el rediseño.
