import { useEffect, useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { getReportDraft } from "../lib/offline-report-store";

interface Props {
  visible?: boolean;
  userId?: string;
  reportId?: string;
  finalized?: boolean;
}

export default function OfflineDraftNotice({
  visible = false,
  userId,
  reportId,
  finalized = false,
}: Props) {
  const [storedDraftFound, setStoredDraftFound] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (visible) setDismissed(false);
  }, [visible]);

  useEffect(() => {
    if (!userId || !reportId) return;
    let active = true;
    void getReportDraft(userId, reportId).then((draft) => {
      if (active) setStoredDraftFound(Boolean(draft));
    }).catch(() => {
      // The editor owns actionable storage errors. This read-only notice must not
      // claim that a local draft exists when IndexedDB could not be inspected.
    });
    return () => { active = false; };
  }, [reportId, userId]);

  useEffect(() => {
    if (!visible && !storedDraftFound) return;
    const protect = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", protect);
    return () => window.removeEventListener("beforeunload", protect);
  }, [storedDraftFound, visible]);

  if ((!visible && !storedDraftFound) || dismissed) return null;

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
