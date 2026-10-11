import { useCallback, useState, type ReactNode } from "react";
import PlatformModal from "../PlatformModal";
import { unsyncedCount } from "@/lib/offline/outbox";
import { forgetCurrentUser } from "@/lib/offline/snapshot";
import { markServerLogoutPending } from "@/lib/offline/offline-auth";
import { getConnectivitySnapshot } from "@/lib/connectivity";
import { isConnectionDown } from "@/lib/offline/hooks";

/**
 * MINOR-7: las cookies sb-* de @supabase/ssr no son HttpOnly (el servidor usa las opciones por defecto), así que el
 * logout sin conexión las borra desde el navegador; el cierre en el servidor queda pendiente igualmente.
 */
export function clearSessionCookies() {
  if (typeof document === "undefined") return;
  for (const part of document.cookie.split(";")) {
    const name = part.split("=")[0]?.trim();
    if (name && name.startsWith("sb-")) document.cookie = `${name}=; Max-Age=0; Path=/; SameSite=Lax`;
  }
}

/**
 * T086: antes de cerrar sesión consulta la outbox del usuario. Con datos sin subir pide confirmación explícita;
 * los datos NO se borran (siguen en este dispositivo, aislados por usuario) pero otra persona no podrá subirlos.
 */
export function useLogoutGuard(userId: string | undefined, submit: () => void): { request: () => void; dialog: ReactNode } {
  const [count, setCount] = useState<number | null>(null);
  // Logout CONFIRMADO: el dispositivo olvida al usuario (los datos del usuario se conservan) y luego se envía el formulario.
  // Sin conexión no se puede cerrar la cookie del servidor: se cierra la sesión local, queda pendiente el cierre en el
  // servidor (se completa en la primera página con red) y se vuelve a la pantalla de acceso.
  const finish = useCallback(() => {
    void forgetCurrentUser().then(async () => {
      if (isConnectionDown(getConnectivitySnapshot().state)) {
        try { await markServerLogoutPending(); } catch { /* sin IndexedDB */ }
        clearSessionCookies();
        window.location.assign("/iniciar-sesion");
      } else {
        submit();
      }
    }, submit);
  }, [submit]);
  const request = useCallback(() => {
    if (!userId) { finish(); return; }
    void unsyncedCount(userId).then((n) => { if (n > 0) setCount(n); else finish(); }, () => finish());
  }, [userId, finish]);
  const dialog = count === null ? null : (
    <PlatformModal
      title="Tienes datos sin subir"
      cancelLabel="Quedarme"
      confirmLabel="Cerrar sesión de todos modos"
      destructive
      onCancel={() => setCount(null)}
      onConfirm={() => { setCount(null); finish(); }}
    >
      <p>Tienes {count} {count === 1 ? "dato" : "datos"} sin subir en este dispositivo. Si cierras sesión ahora, seguirán guardados aquí, pero no se subirán hasta que vuelvas a iniciar sesión con tu usuario y confirmes la subida.</p>
    </PlatformModal>
  );
  return { request, dialog };
}
