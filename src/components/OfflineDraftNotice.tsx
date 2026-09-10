import { useEffect, useState } from "react";
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
    <section className="panel border-amber-300 bg-amber-50" role="status" aria-live="polite">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-lg font-bold text-amber-950">Cambios locales pendientes</h2>
          <p className="mt-1 text-sm text-amber-900">
            {finalized
              ? "Hay cambios guardados en este dispositivo, pero el reporte ya no está en borrador. Los datos locales se conservaron para una revisión posterior."
              : "Hay cambios guardados en este dispositivo que no se aplicaron automáticamente porque el reporte cambió en el servidor. Los datos locales se conservaron."}
          </p>
        </div>
        <button className="button-secondary shrink-0" type="button" onClick={() => setDismissed(true)}>
          Entendido
        </button>
      </div>
    </section>
  );
}
