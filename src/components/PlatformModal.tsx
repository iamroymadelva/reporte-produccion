import { useEffect, useId, useRef, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";

interface Props {
  title: string;
  children: ReactNode;
  cancelLabel?: string;
  confirmLabel: string;
  destructive?: boolean;
  confirmDisabled?: boolean;
  initialFocusRef?: RefObject<HTMLElement | null>;
  onCancel: () => void;
  onConfirm: () => void;
}

export default function PlatformModal({
  title,
  children,
  cancelLabel = "Volver",
  confirmLabel,
  destructive = false,
  confirmDisabled = false,
  initialFocusRef,
  onCancel,
  onConfirm,
}: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const surfaceRef = useRef<HTMLElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const onCancelRef = useRef(onCancel);
  const titleId = useId();

  onCancelRef.current = onCancel;

  useEffect(() => {
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = dialogRef.current;
    if (!dialog) return;

    const handleClose = () => onCancelRef.current();
    dialog.addEventListener("close", handleClose);
    dialog.showModal();
    const focusFrame = window.requestAnimationFrame(() => {
      (initialFocusRef?.current ?? cancelRef.current)?.focus();
    });

    return () => {
      window.cancelAnimationFrame(focusFrame);
      dialog.removeEventListener("close", handleClose);
      if (dialog.open) dialog.close();
      previouslyFocused?.focus();
    };
  }, []);

  return createPortal(
    <dialog ref={dialogRef} className="m-auto max-h-[calc(100dvh-1rem)] w-[min(calc(100vw-1rem),32rem)] overflow-hidden rounded-2xl bg-white p-0 shadow-2xl backdrop:bg-slate-950/55 sm:max-h-[calc(100dvh-2rem)]" aria-labelledby={titleId} onMouseDown={(event) => {
      if (event.target === event.currentTarget) dialogRef.current?.close();
    }}>
      <section ref={surfaceRef} className="grid max-h-[calc(100dvh-1rem)] grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden sm:max-h-[calc(100dvh-2rem)]">
        <h2 id={titleId} className="px-5 pt-5 text-2xl font-bold text-slate-950 sm:px-6 sm:pt-6">{title}</h2>
        <div className="mt-4 overflow-y-auto px-5 text-base leading-7 text-slate-600 sm:px-6">{children}</div>
        <div className="safe-bottom mt-5 flex flex-col-reverse gap-3 border-t border-slate-200 bg-slate-50 px-5 pt-4 sm:mt-7 sm:flex-row sm:justify-end sm:px-6">
          <button ref={cancelRef} className="button-secondary min-h-12" type="button" onClick={() => dialogRef.current?.close()}>{cancelLabel}</button>
          <button className={`${destructive ? "button-danger" : "button-primary"} min-h-12`} type="button" disabled={confirmDisabled} onClick={onConfirm}>{confirmLabel}</button>
        </div>
      </section>
    </dialog>,
    document.body,
  );
}
