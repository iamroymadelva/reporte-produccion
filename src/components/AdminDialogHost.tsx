import { useEffect, useRef, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogContent, AlertDialogDescription, AlertDialogTitle } from "@/components/ui/alert-dialog";

type ActiveDialog = { html: string; title: string; alert: boolean; large: boolean };

export default function AdminDialogHost() {
  const [active, setActive] = useState<ActiveDialog | null>(null);
  const opener = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const open = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const control = target.closest<HTMLElement>("[data-admin-modal-open], [data-modal-open], [data-user-reactivate-open]");
      if (!control) return;
      const id = control.dataset.adminModalOpen ?? control.dataset.modalOpen ?? control.dataset.userReactivateOpen;
      const template = id && document.getElementById(id);
      if (!(template instanceof HTMLTemplateElement)) return;
      opener.current = control;
      setActive({
        html: template.innerHTML,
        title: template.dataset.dialogTitle ?? control.getAttribute("aria-label") ?? control.textContent?.trim() ?? "Acción",
        alert: template.dataset.dialogKind === "alert",
        large: template.dataset.dialogSize === "large",
      });
    };
    document.addEventListener("click", open);
    return () => document.removeEventListener("click", open);
  }, []);

  const close = () => setActive(null);
  const handleClick = (event: React.MouseEvent) => {
    if (event.target instanceof Element && event.target.closest("[data-admin-modal-close], [data-modal-close], [data-user-reactivate-close]")) close();
  };
  const restoreFocus = (event: Event) => { event.preventDefault(); opener.current?.focus(); };
  if (!active) return null;
  const width = active.large ? "sm:max-w-4xl" : "sm:max-w-xl";
  if (active.alert) return <AlertDialog open onOpenChange={(next) => { if (!next) close(); }}>
    <AlertDialogContent className={`max-h-[calc(100dvh-1rem)] w-[calc(100vw-1rem)] overflow-y-auto p-0 ${width}`} onCloseAutoFocus={restoreFocus} onClickCapture={handleClick}>
      <AlertDialogTitle className="sr-only">{active.title}</AlertDialogTitle>
      <AlertDialogDescription className="sr-only">Confirma la acción sobre el registro seleccionado.</AlertDialogDescription>
      <div dangerouslySetInnerHTML={{ __html: active.html }} />
    </AlertDialogContent>
  </AlertDialog>;
  return <Dialog open onOpenChange={(next) => { if (!next) close(); }}>
    <DialogContent className={`max-h-[calc(100dvh-1rem)] w-[calc(100vw-1rem)] overflow-y-auto p-0 ${width}`} onCloseAutoFocus={restoreFocus} onClickCapture={handleClick}>
      <DialogTitle className="sr-only">{active.title}</DialogTitle>
      <DialogDescription className="sr-only">Formulario de administración.</DialogDescription>
      <div dangerouslySetInnerHTML={{ __html: active.html }} />
    </DialogContent>
  </Dialog>;
}
