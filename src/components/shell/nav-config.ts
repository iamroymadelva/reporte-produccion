import {
  ArrowLeftRight, Bell, Building2, ChartColumn, CircleHelp, ClipboardList, Cog, Droplets, History, LayoutDashboard, OctagonAlert, Package, Settings, Timer, UserRound, Users, Waypoints,
  type LucideIcon,
} from "lucide-react";
import type { AppRole } from "@/lib/types";

export type NavItem = {
  title: string;
  href: string;
  icon: LucideIcon;
  /** Solo se marca activo con coincidencia exacta de ruta. */
  exact?: boolean;
  /** Si se define, solo estos roles ven el ítem (por defecto, los del grupo). */
  roles?: AppRole[];
};

export type NavGroupId = "operacion" | "administracion" | "cuenta";

export type NavGroup = {
  id: NavGroupId;
  label: string;
  items: NavItem[];
  roles?: AppRole[];
  collapsible?: boolean;
};

export type BreadcrumbEntry = { label: string; href?: string };

const dashboard: NavItem = { title: "Dashboard", href: "/dashboard", icon: LayoutDashboard, exact: true };
const reportes: NavItem = { title: "Reportes", href: "/reportes", icon: ClipboardList };
const indicadores: NavItem = { title: "Indicadores", href: "/indicadores", icon: ChartColumn, roles: ["ROOT", "ADMINISTRATOR", "VIEWER"] };
const notificaciones: NavItem = { title: "Notificaciones", href: "/notificaciones", icon: Bell };
/** Ayuda: visible para todos los roles (la página filtra el contenido por rol). */
export const ayuda: NavItem = { title: "Ayuda", href: "/ayuda", icon: CircleHelp };
/** Mi cuenta: preferencias personales (formato de hora) y cambio de contraseña; visible para todos los roles. */
export const cuenta: NavItem = { title: "Mi cuenta", href: "/cuenta", icon: UserRound };

export const adminItems: NavItem[] = [
  { title: "Resumen", href: "/administracion", icon: Settings, exact: true },
  { title: "Usuarios", href: "/administracion/usuarios", icon: Users },
  { title: "Máquinas", href: "/administracion/maquinas", icon: Cog },
  { title: "Líneas", href: "/administracion/lineas", icon: Waypoints },
  { title: "Productos", href: "/administracion/productos", icon: Package },
  { title: "Clientes", href: "/administracion/clientes", icon: Building2 },
  { title: "Dosificadores", href: "/administracion/dosificadores", icon: Droplets },
  { title: "Turnos", href: "/administracion/turnos", icon: Timer },
  { title: "Categorías de parada", href: "/administracion/paradas", icon: OctagonAlert },
  { title: "Tipos de cambio", href: "/administracion/tipos-cambio", icon: ArrowLeftRight },
  { title: "Historial administrativo", href: "/administracion/historial", icon: History, roles: ["ROOT"] },
];

/** Fuente única de íconos por sección de administración (la usa también AdminCategoryIcon). */
export const sectionIcons = {
  users: Users,
  machines: Cog,
  products: Package,
  clients: Building2,
  lines: Waypoints,
  dosifiers: Droplets,
  shifts: Timer,
  stops: OctagonAlert,
  changes: ArrowLeftRight,
  reports: ClipboardList,
} as const satisfies Record<string, LucideIcon>;

export type SectionIconKey = keyof typeof sectionIcons;

export const navGroups: NavGroup[] = [
  { id: "operacion", label: "Operación", items: [dashboard, reportes, indicadores] },
  { id: "administracion", label: "Administración", items: adminItems, roles: ["ROOT", "ADMINISTRATOR"], collapsible: true },
  { id: "cuenta", label: "Cuenta", items: [notificaciones, cuenta, ayuda] },
];

/** Pestañas del BottomNav móvil (el botón "Más" se añade en el componente). */
export const mobileTabs: NavItem[] = [dashboard, reportes, notificaciones];

export function navForRole(role: AppRole): NavGroup[] {
  return navGroups
    .filter((group) => !group.roles || group.roles.includes(role))
    .map((group) => ({ ...group, items: group.items.filter((item) => !item.roles || item.roles.includes(role)) }));
}

function normalize(pathname: string) {
  return pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
}

/** Dashboard y el resumen de administración son exactos; el resto coincide por prefijo. */
export function isActivePath(pathname: string, href: string): boolean {
  const path = normalize(pathname);
  if (href === "/dashboard" || href === "/administracion") return path === href;
  return path === href || path.startsWith(`${href}/`);
}

export function breadcrumbFor(pathname: string): BreadcrumbEntry[] {
  const path = normalize(pathname);
  const home: BreadcrumbEntry = { label: "Inicio", href: "/dashboard" };
  if (path.startsWith("/reportes/")) return [home, { label: "Detalle de reporte" }];
  if (path === "/administracion") return [home, { label: "Administración" }];
  const admin = adminItems.find((item) => item.href !== "/administracion" && isActivePath(path, item.href));
  if (admin) return [home, { label: "Administración", href: "/administracion" }, { label: admin.title }];
  const item = [dashboard, reportes, indicadores, notificaciones, cuenta, ayuda].find((entry) => isActivePath(path, entry.href));
  return [home, { label: item?.title ?? "Plataforma" }];
}
