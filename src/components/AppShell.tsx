import { useEffect, useState } from "react";
import { Collapsible } from "radix-ui";
import { Bell, ChevronDown, ChevronLeft, ChevronRight, ClipboardList, Factory, LayoutDashboard, LogOut, Menu, Settings, UserRound } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import NotificationCenter from "@/components/NotificationCenter";
import { roleLabels, type Profile } from "@/lib/types";

const adminLinks = [
  ["/administracion/usuarios", "Usuarios"], ["/administracion/maquinas", "Máquinas"],
  ["/administracion/lineas", "Líneas"], ["/administracion/productos", "Productos"],
  ["/administracion/clientes", "Clientes"], ["/administracion/dosificadores", "Dosificadores"],
  ["/administracion/turnos", "Turnos"], ["/administracion/paradas", "Categorías de parada"],
] as const;

function titleFor(pathname: string) {
  if (pathname === "/dashboard") return "Dashboard";
  if (pathname === "/reportes") return "Reportes";
  if (pathname.startsWith("/reportes/")) return "Detalle de reporte";
  if (pathname === "/notificaciones") return "Notificaciones";
  if (pathname === "/administracion") return "Administración";
  return adminLinks.find(([href]) => pathname === href)?.[1] ?? "Plataforma";
}

export default function AppShell({ profile, pathname }: { profile: Profile; pathname: string }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [adminOpen, setAdminOpen] = useState(pathname.startsWith("/administracion"));

  useEffect(() => {
    const stored = localStorage.getItem("production-sidebar-collapsed") === "true";
    setCollapsed(stored);
    document.body.dataset.shellCollapsed = String(stored);
    return () => { delete document.body.dataset.shellCollapsed; };
  }, []);

  const toggleCollapsed = () => {
    setCollapsed((previous) => {
      const next = !previous;
      localStorage.setItem("production-sidebar-collapsed", String(next));
      document.body.dataset.shellCollapsed = String(next);
      return next;
    });
  };

  const sidebar = (mobile: boolean) => <div className="flex h-full min-h-0 flex-col bg-brand-950 text-white">
    <a href="/dashboard" className="flex min-h-20 items-center gap-3 border-b border-white/10 px-4 font-bold tracking-tight" aria-label="Reporte de Producción, dashboard">
      <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-accent-500 text-slate-950"><Factory className="size-6" aria-hidden="true" /></span>
      {(mobile || !collapsed) && <span className="leading-tight">Reporte de<br />Producción</span>}
    </a>
    <nav aria-label="Navegación principal" className="min-h-0 flex-1 space-y-1 overflow-y-auto p-3">
      <a className={`app-nav-link ${pathname === "/dashboard" ? "app-nav-link--active" : ""}`} href="/dashboard" aria-current={pathname === "/dashboard" ? "page" : undefined} title="Dashboard" onClick={() => setMobileOpen(false)}><LayoutDashboard className="size-5 shrink-0" aria-hidden="true" />{(mobile || !collapsed) && <span>Dashboard</span>}</a>
      <a className={`app-nav-link ${pathname.startsWith("/reportes") ? "app-nav-link--active" : ""}`} href="/reportes" aria-current={pathname.startsWith("/reportes") ? "page" : undefined} title="Reportes" onClick={() => setMobileOpen(false)}><ClipboardList className="size-5 shrink-0" aria-hidden="true" />{(mobile || !collapsed) && <span>Reportes</span>}</a>
      {profile.role === "ADMINISTRATOR" && <Collapsible.Root open={adminOpen && (mobile || !collapsed)} onOpenChange={setAdminOpen}>
        <Collapsible.Trigger className={`app-nav-link w-full ${pathname.startsWith("/administracion") ? "app-nav-link--active" : ""}`} aria-label="Administración" title="Administración" onClick={() => { if (collapsed && !mobile) { toggleCollapsed(); setAdminOpen(true); } }}>
          <Settings className="size-5 shrink-0" aria-hidden="true" />{(mobile || !collapsed) && <><span className="flex-1 text-left">Administración</span><ChevronDown className={`size-4 transition-transform ${adminOpen ? "rotate-180" : ""}`} aria-hidden="true" /></>}
        </Collapsible.Trigger>
        <Collapsible.Content className="space-y-1 pb-1 pl-4 pt-1">
          <a href="/administracion" className={`app-nav-link app-nav-sub ${pathname === "/administracion" ? "app-nav-link--active" : ""}`} onClick={() => setMobileOpen(false)}>Resumen</a>
          {adminLinks.map(([href, label]) => <a key={href} href={href} className={`app-nav-link app-nav-sub ${pathname === href ? "app-nav-link--active" : ""}`} aria-current={pathname === href ? "page" : undefined} onClick={() => setMobileOpen(false)}>{label}</a>)}
        </Collapsible.Content>
      </Collapsible.Root>}
      <a className={`app-nav-link ${pathname === "/notificaciones" ? "app-nav-link--active" : ""}`} href="/notificaciones" aria-current={pathname === "/notificaciones" ? "page" : undefined} title="Notificaciones" onClick={() => setMobileOpen(false)}><Bell className="size-5 shrink-0" aria-hidden="true" />{(mobile || !collapsed) && <span>Notificaciones</span>}</a>
    </nav>
    {!mobile && <button type="button" onClick={toggleCollapsed} className="flex min-h-12 items-center justify-center gap-2 border-t border-white/10 text-sm text-brand-100 hover:bg-white/10" aria-label={collapsed ? "Expandir barra lateral" : "Contraer barra lateral"}>{collapsed ? <ChevronRight className="size-5" /> : <><ChevronLeft className="size-5" /> Contraer</>}</button>}
  </div>;

  const title = titleFor(pathname);
  return <>
    <aside className="app-sidebar hidden lg:block" aria-label="Barra lateral">{sidebar(false)}</aside>
    <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
      <SheetContent side="left" className="w-[min(19rem,calc(100vw-2rem))] border-0 p-0 [&>button]:text-white"><SheetHeader className="sr-only"><SheetTitle>Navegación</SheetTitle></SheetHeader>{sidebar(true)}</SheetContent>
    </Sheet>
    <header className="app-header">
      <div className="flex min-w-0 items-center gap-3">
        <button type="button" className="grid size-11 shrink-0 place-items-center rounded-lg border bg-white text-slate-700 lg:hidden" onClick={() => setMobileOpen(true)} aria-label="Abrir menú"><Menu className="size-5" /></button>
        <div className="min-w-0">
          <nav aria-label="Ruta de navegación" className="hidden text-xs text-slate-500 sm:block"><ol className="flex items-center gap-1"><li><a className="hover:underline" href="/dashboard">Inicio</a></li><li aria-hidden="true">/</li>{pathname.startsWith("/administracion/") && <><li><a className="hover:underline" href="/administracion">Administración</a></li><li aria-hidden="true">/</li></>}<li aria-current="page" className="truncate">{title}</li></ol></nav>
          <strong className="block truncate text-base text-slate-950 sm:text-lg">{title}</strong>
        </div>
      </div>
      <div className="flex items-center gap-2">
        {pathname === "/notificaciones" ? <a href="/notificaciones" className="grid size-11 place-items-center rounded-lg border bg-white text-brand-800" aria-label="Notificaciones" aria-current="page"><Bell className="size-5" /></a> : <NotificationCenter />}
        <DropdownMenu>
          <DropdownMenuTrigger asChild><button type="button" className="flex min-h-11 items-center gap-2 rounded-lg border bg-white px-2 text-slate-800 hover:bg-slate-50" aria-label={`Cuenta de ${profile.full_name}`}><span className="grid size-8 place-items-center rounded-full bg-brand-100 text-brand-900"><UserRound className="size-4" /></span><span className="hidden max-w-32 truncate text-sm font-semibold sm:inline">{profile.full_name}</span><ChevronDown className="hidden size-4 sm:inline" /></button></DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel><span className="block truncate">{profile.full_name}</span><span className="block text-xs font-normal text-slate-600">{roleLabels[profile.role]}</span></DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild><a href="/notificaciones"><Bell className="size-4" /> Notificaciones</a></DropdownMenuItem>
            <DropdownMenuSeparator />
            <form method="POST" action="/api/auth/logout"><DropdownMenuItem asChild><button type="submit" className="w-full"><LogOut className="size-4" /> Salir</button></DropdownMenuItem></form>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  </>;
}
