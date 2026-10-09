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

### Acento / CTA (`--cta`, ámbar de señalización)

| Token | Hex | Uso |
| --- | --- | --- |
| `--cta` (oscuro) / `accent-400` | `#FBBF24` | CTA en modo oscuro; indicador de navegación activa (`--sidebar-primary`) |
| `--cta` (claro) / `accent-500` | `#F59E0B` | CTA de creación (`<Button variant="accent">`, `bg-cta text-cta-foreground`) con texto `#0F172A` (8.3:1) |

> `--accent` / `--accent-foreground` son **neutros de interacción** (semántica shadcn: hover/foco en menús, select, skeleton, ghost): `#F1F5F9`/`#0F172A` en claro, `#1E293B`/`#F8FAFC` en oscuro. El ámbar de marca vive en `--cta` y `--sidebar-primary`, no en `accent`.

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
| Interfaz y títulos | **Geist Variable** (`--font-sans`) | 100–900 (variable) |
| Datos numéricos, folios, códigos de máquina | **Geist Mono Variable** (`--font-mono`, `font-mono`) | 100–900 (variable) |

Se sirven localmente con `@fontsource-variable/geist` y `@fontsource-variable/geist-mono`
(importadas en `global.css`), no desde Google Fonts: la app es PWA con soporte sin conexión y el
service worker cachea `/_astro/`. Misma familia tipográfica que barstock.

| Escala | Clase | Uso |
| --- | --- | --- |
| H1 | `text-xl font-bold tracking-tight lg:text-3xl` | Título de página (único por vista) |
| Descripción | `text-sm text-muted-foreground` | Bajo el H1 |
| Título de card | `text-base font-semibold leading-none` / `CardTitle` | Paneles y secciones |
| Cuerpo | 16px, `leading-relaxed` | Mínimo 16px en móvil |
| KPI | `text-2xl font-bold tabular-nums` | Indicadores (sin eyebrow) |

Ya no existe eyebrow: `PageHeader.astro` no admite esa prop.

## 4. Espaciado, forma y elevación

- Escala base de 4px (Tailwind). Contenedor: `max-w-7xl`, gutter `px-4 sm:px-6`.
- Radios: botones y controles `rounded-md`; `Card` base `rounded-xl` y **en páginas `rounded-2xl`**; badges `rounded-full`.
- Elevación: una sola sombra (`shadow-sm`) para paneles; `shadow-xl` solo para modales y avisos flotantes.
- Bordes de 1px `slate-200` separan; no usar sombras para separar filas.

## 5. Componentes (clases en `global.css`)

| Clase | Descripción |
| --- | --- |
| `.button-primary` | Fondo `brand-800`, texto blanco, alto 48px |
| `<Button variant="accent">` | Fondo `--cta`, texto `--cta-foreground`. **Un solo uso por vista** (crear reporte) |
| `.button-secondary` | Blanco, borde `slate-300`; estado activo con `aria-current`/`.is-active` |
| `.button-danger` | Fondo `red-700`, texto blanco |
| `.field-label` / `.field-control` | Etiqueta siempre visible; foco `brand-600` con anillo `brand-100` |
| `Card` | `bg-card text-card-foreground flex flex-col gap-6 rounded-xl border py-6 shadow-sm`; en páginas `rounded-2xl`, con `CardHeader`/`CardTitle`/`CardDescription` y tablas dentro |
| `.link` | Enlace de acción `brand-700`, subrayado en hover |
| `.data-table` | Encabezado `slate-50` en mayúsculas 12px, filas con hover `slate-50` |
| KPI | `Card rounded-2xl` con `CardHeader` (título `text-sm font-medium` + ícono lucide `h-4 w-4` coloreado), valor `text-2xl font-bold tabular-nums` y subtítulo `text-xs text-muted-foreground`. **Sin franja lateral**; el estado se comunica con borde tintado sutil (`border-warning/20`, `border-destructive/20`, `border-stop/20`) e ícono |

## 6. Navegación

- **Sidebar claro** en modo claro (`--sidebar #fafafa`, ítem activo `bg-sidebar-accent font-medium`, marca y
  `--sidebar-primary` en `#1e40af`); en modo oscuro conserva fondo azul marino `#0a1023`. Sin barras ni
  indicadores ámbar. Cabecera: ícono `Factory` `size-7 text-sidebar-primary`, rótulo "PLANTA" en
  mayúsculas pequeñas y nombre "Reporte de Producción" en `font-bold text-sidebar-primary`.
- Grupos con etiqueta por defecto del primitive (`text-xs font-medium text-sidebar-foreground/70`); el grupo
  de Administración es colapsable con chevron rotatorio. `aria-current="page"` en el ítem activo.
- Pie: botón fantasma con `Avatar` (`bg-sidebar-accent`), nombre `font-medium truncate` y rol `text-xs text-muted-foreground`.
  Menú de cuenta: Notificaciones, alternar tema (ítem simple "Modo claro" con `Sun` / "Modo oscuro" con `Moon`)
  y "Cerrar sesión" en `text-destructive`.
- Barra superior: `sticky`-equivalente fija (por `transition:persist`) `h-14 border-b bg-card/95 backdrop-blur px-4 gap-3`.
  Insignia de campana `bg-destructive text-destructive-foreground` (se oculta con 0 sin leer).
- Móvil (< 1024px): `BottomNav` de 4 pestañas (Dashboard, Reportes, Notificaciones, Más), activa en `text-primary`.
- Contenedor de página: `mx-auto w-full max-w-7xl space-y-6 px-4 py-4 sm:px-6 sm:py-6` sobre `bg-background`.

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

## 11. Paridad visual con barstock (iteración 2)

Se adoptó el estilo de barstock en todo salvo la paleta (primario azul `#1e40af` / `#60a5fa` en oscuro,
CTA ámbar y semánticos propios en lugar del verde emerald):

- **Tipografía** Geist / Geist Mono (§3). **Radios**: `rounded-md` en botones, `rounded-2xl` en cards de página.
- **Botones**: `rounded-md text-sm font-medium`. **Única desviación**: altura táctil mínima `min-h-11` (44px) en
  `default` y `min-h-12` (48px) en `lg` (barstock usa 36/40px) por el uso en planta con tablets y guantes.
- **Sidebar claro** y estructura de cabecera/pie (§6). **KPI sin franja lateral** (§5).
- **Encabezados** `PageHeader`: sin eyebrow; enlace "volver" pequeño `text-sm text-muted-foreground` con `ArrowLeft` sobre el título.
- **Login y páginas públicas** (`iniciar-sesion`, `recuperar-contrasena`, `configurar-contrasena`, `auth/confirmar`):
  fondo degradado con tokens `--auth-from/--auth-via/--auth-to` (`from-auth-from via-auth-via to-auth-to`), `Card w-full max-w-md shadow-2xl`,
  logo `p-4 rounded-2xl bg-primary shadow-lg` con `Factory`, título centrado `text-2xl font-bold`, `CardFooter` con botón `w-full` `lg`.
  El H1 de la tarjeta es el único de la página.
