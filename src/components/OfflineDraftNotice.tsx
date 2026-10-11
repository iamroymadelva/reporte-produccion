import { useEffect, useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

interface Props {
  visible?: boolean;
  finalized?: boolean;
}

export default function OfflineDraftNotice({
  visible = false,
  finalized = false,
}: Props) {
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (visible) setDismissed(false);
  }, [visible]);

  useEffect(() => {
    if (!visible) return;
    const protect = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", protect);
    return () => window.removeEventListener("beforeunload", protect);
  }, [visible]);

  if (!visible || dismissed) return null;

  return (
    <Alert variant="warning" role="status" aria-live="polite">
      <AlertTitle className="text-base">Cambios locales pendientes</AlertTitle>
      <AlertDescription>
        <p>
          {finalized
            ? "Hay cambios guardados en este dispositivo, pero el reporte ya no está en borrador. Los datos locales se conservaron para una revisión posterior."
            : "Hay cambios guardados en este dispositivo que no se aplicaron automáticamente porque el reporte cambió en el servidor. Los datos locales se conservaron."}
        </p>
        <Button className="mt-3" variant="outline" type="button" onClick={() => setDismissed(true)}>
          Entendido
        </Button>
      </AlertDescription>
    </Alert>
  );
}
