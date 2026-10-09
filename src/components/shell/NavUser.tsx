import { useRef } from "react";
import { Bell, ChevronsUpDown, LogOut, Moon, Sun } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { SidebarMenu, SidebarMenuItem, useSidebar } from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import { roleLabels, type Profile } from "@/lib/types";
import { useTheme } from "@/lib/theme";

export function initialsFor(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  return ((parts[0][0] ?? "") + (parts.length > 1 ? parts[parts.length - 1][0] ?? "" : "")).toUpperCase();
}

/**
 * El <form> de cierre de sesión vive FUERA del menú (hermano, oculto): el interceptor global de submit
 * (BaseLayout) espera una comprobación de red antes de reenviar, y para entonces el menú ya se cerró y
 * desmontó su contenido. El ítem solo dispara requestSubmit() sobre el formulario persistente.
 */
function LogoutForm({ formRef }: { formRef: React.RefObject<HTMLFormElement | null> }) {
  return <form ref={formRef} method="POST" action="/api/auth/logout" data-astro-reload hidden />;
}

function MenuBody({ profile, onLogout }: { profile: Profile; onLogout: () => void }) {
  const { resolvedTheme, setTheme } = useTheme();
  const dark = resolvedTheme === "dark";
  return <>
    <DropdownMenuLabel className="font-normal">
      <span className="block truncate text-sm font-semibold">{profile.full_name}</span>
      <span className="block text-xs text-muted-foreground">{roleLabels[profile.role]}</span>
    </DropdownMenuLabel>
    <DropdownMenuSeparator />
    <DropdownMenuItem asChild><a href="/notificaciones"><Bell className="size-4" /> Notificaciones</a></DropdownMenuItem>
    <DropdownMenuItem onClick={() => setTheme(dark ? "light" : "dark")}>
      {dark ? <Sun className="size-4" /> : <Moon className="size-4" />}
      {dark ? "Modo claro" : "Modo oscuro"}
    </DropdownMenuItem>
    <DropdownMenuSeparator />
    <DropdownMenuItem className="text-destructive focus:text-destructive" onSelect={(event) => { event.preventDefault(); onLogout(); }}><LogOut className="size-4 text-destructive" /> Cerrar sesión</DropdownMenuItem>
  </>;
}

type Props = { profile: Profile; variant?: "sidebar" | "icon" };

export function NavUser({ profile, variant = "sidebar" }: Props) {
  const { isMobile } = useSidebar();
  const initials = initialsFor(profile.full_name);
  const logoutFormRef = useRef<HTMLFormElement>(null);
  const onLogout = () => logoutFormRef.current?.requestSubmit();

  if (variant === "icon") {
    return <>
      <LogoutForm formRef={logoutFormRef} />
      <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="ghost" size="icon" className="rounded-full" aria-label={`Cuenta de ${profile.full_name}`}>
          <Avatar className="size-8"><AvatarFallback className="bg-primary text-xs font-semibold text-primary-foreground">{initials}</AvatarFallback></Avatar>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60"><MenuBody profile={profile} onLogout={onLogout} /></DropdownMenuContent>
    </DropdownMenu>
    </>;
  }

  return <SidebarMenu>
    <SidebarMenuItem>
      <LogoutForm formRef={logoutFormRef} />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button type="button" variant="ghost" className="h-auto w-full justify-start gap-3 px-2 py-2 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground data-[state=open]:bg-sidebar-accent group-data-[collapsible=icon]:size-8 group-data-[collapsible=icon]:p-0" aria-label={`Cuenta de ${profile.full_name}`}>
            <Avatar className="size-8"><AvatarFallback className="bg-sidebar-accent text-xs font-semibold text-sidebar-accent-foreground">{initials}</AvatarFallback></Avatar>
            <div className="grid min-w-0 flex-1 text-left leading-tight group-data-[collapsible=icon]:hidden">
              <span className="truncate text-sm font-medium">{profile.full_name}</span>
              <span className="truncate text-xs text-muted-foreground">{roleLabels[profile.role]}</span>
            </div>
            <ChevronsUpDown className="ml-auto size-4 group-data-[collapsible=icon]:hidden" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent side={isMobile ? "top" : "right"} align="end" sideOffset={8} className="w-60"><MenuBody profile={profile} onLogout={onLogout} /></DropdownMenuContent>
      </DropdownMenu>
    </SidebarMenuItem>
  </SidebarMenu>;
}
