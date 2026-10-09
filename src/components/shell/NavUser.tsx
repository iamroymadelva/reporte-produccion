import { useRef } from "react";
import { Bell, ChevronsUpDown, LogOut, Moon } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem, useSidebar } from "@/components/ui/sidebar";
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
    <DropdownMenuCheckboxItem checked={dark} onCheckedChange={(value) => setTheme(value ? "dark" : "light")}>
      <Moon className="size-4" /> Modo oscuro
    </DropdownMenuCheckboxItem>
    <DropdownMenuSeparator />
    <DropdownMenuItem onSelect={(event) => { event.preventDefault(); onLogout(); }}><LogOut className="size-4" /> Cerrar sesión</DropdownMenuItem>
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
          <SidebarMenuButton size="lg" className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground" aria-label={`Cuenta de ${profile.full_name}`}>
            <Avatar className="size-8 rounded-lg"><AvatarFallback className="rounded-lg bg-sidebar-primary text-xs font-semibold text-sidebar-primary-foreground">{initials}</AvatarFallback></Avatar>
            <div className="grid min-w-0 flex-1 text-left text-sm leading-tight">
              <span className="truncate font-semibold">{profile.full_name}</span>
              <span className="truncate text-xs text-sidebar-foreground/70">{roleLabels[profile.role]}</span>
            </div>
            <ChevronsUpDown className="ml-auto size-4" />
          </SidebarMenuButton>
        </DropdownMenuTrigger>
        <DropdownMenuContent side={isMobile ? "top" : "right"} align="end" sideOffset={8} className="w-60"><MenuBody profile={profile} onLogout={onLogout} /></DropdownMenuContent>
      </DropdownMenu>
    </SidebarMenuItem>
  </SidebarMenu>;
}
