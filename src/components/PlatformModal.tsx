import { type ReactNode, type RefObject } from "react";
import { Button } from "@/components/ui/button";
import { AlertDialog, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";

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
  title, children, cancelLabel = "Volver", confirmLabel, destructive = false,
  confirmDisabled = false, initialFocusRef, onCancel, onConfirm,
}: Props) {
  return <AlertDialog open onOpenChange={(open) => { if (!open) onCancel(); }}>
    <AlertDialogContent className="max-h-[calc(100dvh-1rem)] w-[min(calc(100vw-1rem),32rem)] overflow-y-auto p-0 sm:max-h-[calc(100dvh-2rem)]" onOpenAutoFocus={(event) => {
      if (initialFocusRef?.current) { event.preventDefault(); initialFocusRef.current.focus(); }
    }}>
      <AlertDialogHeader className="px-5 pt-5 sm:px-6 sm:pt-6">
        <AlertDialogTitle className="text-2xl font-bold text-foreground">{title}</AlertDialogTitle>
        <AlertDialogDescription asChild><div className="mt-3 text-base leading-7 text-foreground">{children}</div></AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter className="safe-bottom mt-4 border-t bg-muted/50 px-5 pt-4 sm:px-6">
        <Button variant="outline" size="lg" type="button" onClick={onCancel}>{cancelLabel}</Button>
        <Button variant={destructive ? "destructive" : "default"} size="lg" type="button" disabled={confirmDisabled} onClick={onConfirm}>{confirmLabel}</Button>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>;
}
