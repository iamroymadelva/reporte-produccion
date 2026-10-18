import { useCallback, useRef } from "react";
import { Bell, LogOut, UserRound } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useLogoutGuard } from "@/components/offline/LogoutGuard";
import { isConnectionDown, useConnectivityState } from "@/lib/offline/hooks";
import { roleLabels, type AppRole } from "@/lib/types";

export const REQUIRES_CONNECTION_LABEL = "Requiere conexión";

export function initialsFor(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  return ((parts[0][0] ?? "") + (parts.length > 1 ? parts[parts.length - 1][0] ?? "" : "")).toUpperCase();
}

export interface UserMenuUser { id: string; fullName: string; role: AppRole }

const ITEM_CLASS = "min-h-11 cursor-pointer";

/**
 * Menú de usuario AUTÓNOMO para las pantallas que no usan AppShell (Turno, consulta sin conexión). Es la ÚNICA entrada
 * de «Cerrar sesión» de esas pantallas. El cierre pasa por useLogoutGuard (confirmación si hay datos sin subir y cierre
 * local sin conexión que deja marcado el cierre del servidor). El <form> vive FUERA del menú (como en NavUser) para
 * que el submit siga existiendo cuando el menú se cierra y se desmonta.
 */
export default function UserMenu({ user }: { user: UserMenuUser }) {
  const down = isConnectionDown(useConnectivityState());
  const formRef = useRef<HTMLFormElement>(null);
  const submitLogout = useCallback(() => formRef.current?.requestSubmit(), []);
  const guard = useLogoutGuard(user.role === "OPERATOR" ? user.id : undefined, submitLogout);

  return (
    <>
      {guard.dialog}
      <form ref={formRef} method="POST" action="/api/auth/logout" data-astro-reload hidden />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button type="button" variant="ghost" size="icon" className="size-11 rounded-full" aria-label={`Cuenta de ${user.fullName}`} data-user-menu-trigger>
            <Avatar className="size-9"><AvatarFallback className="bg-primary text-xs font-semibold text-primary-foreground">{initialsFor(user.fullName)}</AvatarFallback></Avatar>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64">
          <DropdownMenuLabel className="font-normal">
            <span className="block truncate text-sm font-semibold">{user.fullName}</span>
            <span className="block text-xs text-muted-foreground">{roleLabels[user.role]}</span>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          {down ? (
            <>
              <DropdownMenuItem disabled className={ITEM_CLASS} aria-disabled="true" data-menu-item="account"><UserRound className="size-4" /> Mi cuenta <span className="ml-auto text-xs text-muted-foreground">{REQUIRES_CONNECTION_LABEL}</span></DropdownMenuItem>
              <DropdownMenuItem disabled className={ITEM_CLASS} aria-disabled="true" data-menu-item="notifications"><Bell className="size-4" /> Notificaciones <span className="ml-auto text-xs text-muted-foreground">{REQUIRES_CONNECTION_LABEL}</span></DropdownMenuItem>
            </>
          ) : (
            <>
              <DropdownMenuItem asChild className={ITEM_CLASS}><a href="/cuenta" data-astro-reload data-menu-item="account"><UserRound className="size-4" /> Mi cuenta</a></DropdownMenuItem>
              <DropdownMenuItem asChild className={ITEM_CLASS}><a href="/notificaciones" data-astro-reload data-menu-item="notifications"><Bell className="size-4" /> Notificaciones</a></DropdownMenuItem>
            </>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem className={`${ITEM_CLASS} text-destructive focus:text-destructive`} data-menu-item="logout" onSelect={(event) => { event.preventDefault(); guard.request(); }}>
            <LogOut className="size-4 text-destructive" /> Cerrar sesión
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}
