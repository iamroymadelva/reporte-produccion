import { Menu } from "lucide-react";
import { useSidebar } from "@/components/ui/sidebar";
import { useNotifications } from "@/components/notifications/use-notifications";
import { cn } from "@/lib/utils";
import { isActivePath, mobileTabs } from "./nav-config";

const tabClass = "relative flex flex-1 flex-col items-center justify-center gap-0.5 text-[11px] touch-manipulation transition-colors";

export function BottomNav({ pathname }: { pathname: string }) {
  const { setOpenMobile } = useSidebar();
  const { count, online } = useNotifications("all");

  return <nav
    aria-label="Navegación móvil"
    className="fixed inset-x-0 bottom-0 z-40 h-16 border-t bg-card/95 backdrop-blur lg:hidden print:hidden"
    style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
  >
    <ul className="grid h-16 grid-cols-4 items-stretch">
      {mobileTabs.map((item) => {
        const active = isActivePath(pathname, item.href);
        const Icon = item.icon;
        const unread = item.href === "/notificaciones" && online && count > 0;
        return <li key={item.href} className="flex">
          <a href={item.href} aria-current={active ? "page" : undefined} className={cn(tabClass, active ? "text-primary" : "text-muted-foreground")}>
            <span className="relative">
              <Icon className="size-5" aria-hidden="true" />
              {unread && <span className="absolute -right-2.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold leading-none text-destructive-foreground">
                {count > 99 ? "99+" : count}<span className="sr-only"> sin leer</span>
              </span>}
            </span>
            <span>{item.title}</span>
          </a>
        </li>;
      })}
      <li className="flex">
        <button type="button" onClick={() => setOpenMobile(true)} className={cn(tabClass, "text-muted-foreground")} aria-label="Más opciones de navegación">
          <Menu className="size-5" aria-hidden="true" />
          <span>Más</span>
        </button>
      </li>
    </ul>
  </nav>;
}
