import { Fragment } from "react";
import { Factory } from "lucide-react";
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from "@/components/ui/breadcrumb";
import { Separator } from "@/components/ui/separator";
import { SidebarTrigger, useSidebar } from "@/components/ui/sidebar";
import { NotificationBell } from "@/components/notifications/NotificationBell";
import { cn } from "@/lib/utils";
import type { Profile } from "@/lib/types";
import { NavUser } from "./NavUser";
import { breadcrumbFor } from "./nav-config";

/**
 * Posición fija (ver comentario en AppShell). El desplazamiento izquierdo en escritorio
 * sigue al estado del sidebar, que el SSR ya conoce por la cookie.
 */
export function TopBar({ profile, pathname }: { profile: Profile; pathname: string }) {
  const { state } = useSidebar();
  const crumbs = breadcrumbFor(pathname);
  const current = crumbs[crumbs.length - 1];

  return <header
    data-slot="shell-topbar"
    className={cn(
      "fixed inset-x-0 top-0 z-30 flex h-14 items-center gap-2 border-b bg-background/95 px-4 backdrop-blur transition-[left] duration-200 ease-linear print:hidden",
      state === "collapsed" ? "lg:left-(--sidebar-width-icon)" : "lg:left-(--sidebar-width)",
    )}
    style={{ paddingTop: "env(safe-area-inset-top)" }}
  >
    <SidebarTrigger className="-ml-1 hidden lg:inline-flex" />
    <Separator orientation="vertical" className="mr-1 hidden data-[orientation=vertical]:h-4 lg:block" />
    <div className="flex min-w-0 items-center gap-2 lg:hidden">
      <span className="grid size-7 shrink-0 place-items-center rounded-md bg-sidebar-primary text-sidebar-primary-foreground" aria-hidden="true"><Factory className="size-4" /></span>
      <p className="truncate text-sm font-semibold">{current.label}</p>
    </div>
    <Breadcrumb className="hidden min-w-0 lg:block">
      <BreadcrumbList>
        {crumbs.map((crumb, index) => {
          const last = index === crumbs.length - 1;
          return <Fragment key={`${crumb.label}-${index}`}>
            <BreadcrumbItem className={last ? "min-w-0" : undefined}>
              {last || !crumb.href ? <BreadcrumbPage className="truncate">{crumb.label}</BreadcrumbPage> : <BreadcrumbLink href={crumb.href}>{crumb.label}</BreadcrumbLink>}
            </BreadcrumbItem>
            {!last && <BreadcrumbSeparator />}
          </Fragment>;
        })}
      </BreadcrumbList>
    </Breadcrumb>
    <div className="ml-auto flex items-center gap-1">
      <NotificationBell />
      <div className="lg:hidden"><NavUser profile={profile} variant="icon" /></div>
    </div>
  </header>;
}
