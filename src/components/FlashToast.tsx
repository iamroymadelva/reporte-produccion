import { useEffect } from "react";
import { toast } from "sonner";

type Props = { ok?: string | null; error?: string | null };

// El <Toaster /> vive en el island AppShell, que puede hidratarse después de este island.
// El contenedor de sonner (section con aria-label "Notificaciones ...") existe desde que se monta el Toaster.
const TOASTER_SELECTOR = '[data-sonner-toaster], section[aria-label^="Notificaciones"]';
const POLL_MS = 50;
const MAX_ATTEMPTS = 60; // ~3 s; pasado ese tiempo se emite igualmente.

/**
 * Convierte los parametros `ok` / `error` de la URL (redirectWithMessage) en toasts y los limpia
 * de la URL. El <Toaster /> vive en el shell persistente (shell/AppShell.tsx): se espera a que exista
 * (reintentos acotados) antes de emitir y de limpiar la URL.
 */
export default function FlashToast({ ok, error }: Props) {
  useEffect(() => {
    if (!ok && !error) return;
    let attempts = 0;
    let timer: number | undefined;
    const emit = () => {
      if (!document.querySelector(TOASTER_SELECTOR) && attempts++ < MAX_ATTEMPTS) {
        timer = window.setTimeout(emit, POLL_MS);
        return;
      }
      if (ok) toast.success(ok, { id: "flash-ok", duration: 4000 });
      if (error) toast.error(error, { id: "flash-error", duration: Infinity, closeButton: true });
      const url = new URL(window.location.href);
      if (url.searchParams.has("ok") || url.searchParams.has("error")) {
        url.searchParams.delete("ok");
        url.searchParams.delete("error");
        history.replaceState(history.state, "", `${url.pathname}${url.search}${url.hash}`);
      }
    };
    timer = window.setTimeout(emit, POLL_MS);
    return () => window.clearTimeout(timer);
  }, [ok, error]);
  return null;
}
