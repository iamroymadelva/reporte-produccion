/**
 * Patrón elegido: el shell NO envuelve el contenido de la página (nada de children).
 * Con ClientRouter el shell debe persistir (`transition:persist`) mientras el contenido
 * de la página se reemplaza; si el contenido fuera children del island, persistiría
 * también. Por eso AppShell renderiza solo Sidebar + TopBar + BottomNav con posición
 * fija y BaseLayout reserva el espacio con CSS (padding de #main-content) usando el
 * `data-state` del sidebar (`:has(...)`), que el SSR ya emite desde la cookie
 * `sidebar_state`. Así el contenido no salta al hidratar.
 */
import { useEffect, useState } from "react";
import { ChevronRight, Factory } from "lucide-react";
import {
  Sidebar, SidebarContent, SidebarFooter, SidebarGroup, SidebarGroupContent, SidebarGroupLabel, SidebarHeader,
  SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarProvider, SidebarRail, useSidebar,
} from "@/components/ui/sidebar";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Toaster } from "@/components/ui/sonner";
import type { Profile } from "@/lib/types";
import { BottomNav } from "./BottomNav";
import { NavUser } from "./NavUser";
import { TopBar } from "./TopBar";
import { isActivePath, navForRole, type NavGroup } from "./nav-config";

const activeIndicator =
  "relative data-[active=true]:before:absolute data-[active=true]:before:inset-y-1.5 data-[active=true]:before:left-0 data-[active=true]:before:w-0.5 data-[active=true]:before:rounded-full data-[active=true]:before:bg-sidebar-primary data-[active=true]:[&>svg]:text-sidebar-primary";

function NavItems({ group, pathname }: { group: NavGroup; pathname: string }) {
  const { isMobile, setOpenMobile } = useSidebar();
  return <SidebarMenu>
    {group.items.map((item) => {
      const active = isActivePath(pathname, item.href);
      const Icon = item.icon;
      return <SidebarMenuItem key={item.href}>
        <SidebarMenuButton asChild isActive={active} tooltip={item.title} className={activeIndicator}>
          <a href={item.href} aria-current={active ? "page" : undefined} onClick={() => { if (isMobile) setOpenMobile(false); }}>
            <Icon aria-hidden="true" />
            <span>{item.title}</span>
          </a>
        </SidebarMenuButton>
      </SidebarMenuItem>;
    })}
  </SidebarMenu>;
}

function NavGroupView({ group, pathname }: { group: NavGroup; pathname: string }) {
  const { state, isMobile } = useSidebar();
  const sectionActive = group.items.some((item) => isActivePath(pathname, item.href));
  const [open, setOpen] = useState(group.id === "administracion" ? pathname.startsWith("/administracion") : true);
  // En modo icono los ítems siempre se muestran (sin etiqueta de grupo).
  const forcedOpen = state === "collapsed" && !isMobile;

  useEffect(() => { if (group.collapsible && sectionActive) setOpen(true); }, [group.collapsible, sectionActive]);

  if (!group.collapsible) {
    return <SidebarGroup>
      <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
      <SidebarGroupContent><NavItems group={group} pathname={pathname} /></SidebarGroupContent>
    </SidebarGroup>;
  }
  return <Collapsible open={forcedOpen || open} onOpenChange={setOpen} className="group/collapsible">
    <SidebarGroup>
      <SidebarGroupLabel asChild className="text-sm hover:bg-sidebar-accent hover:text-sidebar-accent-foreground">
        <CollapsibleTrigger>
          {group.label}
          <ChevronRight className="ml-auto transition-transform group-data-[state=open]/collapsible:rotate-90" aria-hidden="true" />
        </CollapsibleTrigger>
      </SidebarGroupLabel>
      <CollapsibleContent>
        <SidebarGroupContent><NavItems group={group} pathname={pathname} /></SidebarGroupContent>
      </CollapsibleContent>
    </SidebarGroup>
  </Collapsible>;
}

/** Cierra el menú móvil y mantiene el pathname al navegar con ClientRouter (el shell persiste). */
function RouteSync({ onPathname }: { onPathname: (pathname: string) => void }) {
  const { setOpenMobile } = useSidebar();
  useEffect(() => {
    const sync = () => { onPathname(window.location.pathname); setOpenMobile(false); };
    document.addEventListener("astro:after-swap", sync);
    document.addEventListener("astro:page-load", sync);
    return () => {
      document.removeEventListener("astro:after-swap", sync);
      document.removeEventListener("astro:page-load", sync);
    };
  }, [onPathname, setOpenMobile]);
  return null;
}

type Props = { profile: Profile; pathname: string; defaultOpen?: boolean };

export default function AppShell({ profile, pathname: initialPathname, defaultOpen = true }: Props) {
  const [pathname, setPathname] = useState(initialPathname);
  const groups = navForRole(profile.role);

  return <SidebarProvider defaultOpen={defaultOpen} className="contents [&_[data-slot=sidebar-gap]]:hidden">
    <RouteSync onPathname={setPathname} />
    <Sidebar collapsible="icon" className="print:hidden">
      <SidebarHeader className="border-b border-sidebar-border">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" asChild tooltip="Reporte de Producción">
              <a href="/dashboard" aria-label="Reporte de Producción, ir al dashboard">
                <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground"><Factory className="size-5" aria-hidden="true" /></span>
                <span className="grid min-w-0 flex-1 text-left text-sm leading-tight">
                  <span className="truncate font-semibold">Reporte de Producción</span>
                  <span className="truncate text-xs text-sidebar-foreground/70">Planta</span>
                </span>
              </a>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        {groups.map((group) => <NavGroupView key={group.id} group={group} pathname={pathname} />)}
      </SidebarContent>
      <SidebarFooter className="border-t border-sidebar-border"><NavUser profile={profile} /></SidebarFooter>
      <SidebarRail />
    </Sidebar>
    <TopBar profile={profile} pathname={pathname} />
    <BottomNav pathname={pathname} />
    <Toaster position="top-right" closeButton />
  </SidebarProvider>;
}
