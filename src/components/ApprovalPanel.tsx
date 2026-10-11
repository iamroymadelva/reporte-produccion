import { useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { FieldLabel, Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import PlatformModal from "./PlatformModal";
import { guardedMutationFetch } from "../lib/connectivity";
import { formatDateTime } from "../lib/format";

interface Props {
  reportId: string;
  status: string;
  /** El usuario es manager (coordinador o administrador raíz). */
  isManager: boolean;
  /** Motivo por el que no se puede aprobar (p. ej. conflicto de sincronización abierto) o null. */
  approvalBlockedReason?: string | null;
  approverName?: string | null;
  approvedAt?: string | null;
  /** DRAFT abierto fuera de turno: el manager puede cancelarlo. */
  isOffShift?: boolean;
}

async function postJson(url: string, payload?: unknown) {
  const response = await guardedMutationFetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload ?? {}),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error ?? "No fue posible completar la operación.");
}

/** Aprobación (SUBMITTED) y cancelación fuera de turno (DRAFT) para managers; "Aprobado por … el …" en CLOSED. */
export default function ApprovalPanel({
  reportId, status, isManager, approvalBlockedReason = null, approverName, approvedAt, isOffShift = false,
}: Props) {
  const [modal, setModal] = useState<"approve" | "cancel" | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await action();
      window.location.reload();
    } catch (cause) {
      setBusy(false);
      setModal(null);
      setError(cause instanceof Error ? cause.message : "No fue posible completar la operación.");
    }
  };

  if (status === "CLOSED") {
    return (
      <Card className="mb-5 rounded-2xl gap-0 border-success/30 bg-success/10 p-5" aria-label="Aprobación del reporte">
        <p className="text-sm text-muted-foreground">Aprobación</p>
        <p className="mt-1 font-semibold text-foreground">
          Aprobado por {approverName || "—"} el {formatDateTime(approvedAt ?? null)}
        </p>
      </Card>
    );
  }

  if (!isManager) return null;

  if (status === "SUBMITTED") {
    return (
      <Card className="mb-5 rounded-2xl gap-3 p-5" aria-label="Aprobación del reporte">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold leading-none">Aprobación</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Al aprobar, el reporte queda cerrado y solo podrá corregirse con un motivo.
            </p>
          </div>
          <Button size="lg" type="button" disabled={Boolean(approvalBlockedReason) || busy} onClick={() => setModal("approve")}>
            Aprobar y cerrar
          </Button>
        </div>
        {approvalBlockedReason && (
          <Alert variant="warning" role="status"><AlertDescription>{approvalBlockedReason}</AlertDescription></Alert>
        )}
        {error && <Alert variant="destructive" role="alert"><AlertDescription>{error}</AlertDescription></Alert>}
        {modal === "approve" && (
          <PlatformModal
            title="¿Aprobar y cerrar el reporte?"
            confirmLabel={busy ? "Aprobando…" : "Aprobar y cerrar"}
            confirmDisabled={busy}
            onCancel={() => setModal(null)}
            onConfirm={() => void run(() => postJson(`/api/reports/${reportId}/approve`))}
          >
            <p>El reporte pasará a estado Cerrado (aprobado). Podrás corregirlo después indicando un motivo.</p>
          </PlatformModal>
        )}
      </Card>
    );
  }

  if (status === "DRAFT") {
    return (
      <Card className="mb-5 rounded-2xl gap-3 p-5" aria-label="Reporte activo">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold leading-none">Reporte activo (solo lectura)</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {isOffShift
                ? "Este reporte sigue abierto después de terminar el turno."
                : "El operario responsable lo está diligenciando. Solo podrás corregirlo cuando lo envíe."}
            </p>
          </div>
          {isOffShift && (
            <Button variant="destructive" size="lg" type="button" disabled={busy} onClick={() => { setReason(""); setModal("cancel"); }}>
              Cancelar (abierto fuera de turno)
            </Button>
          )}
        </div>
        {error && <Alert variant="destructive" role="alert"><AlertDescription>{error}</AlertDescription></Alert>}
        {modal === "cancel" && (
          <PlatformModal
            title="Cancelar reporte abierto fuera de turno"
            confirmLabel={busy ? "Cancelando…" : "Confirmar cancelación"}
            destructive
            confirmDisabled={!reason.trim() || busy}
            onCancel={() => setModal(null)}
            onConfirm={() => void run(() => postJson(`/api/reports/${reportId}/cancel`, { reason: reason.trim() }))}
          >
            <p>El reporte quedará cancelado y las paradas abiertas se cancelarán con él.</p>
            <Label className="mt-5">
              <FieldLabel>Motivo de cancelación</FieldLabel>
              <Textarea className="min-h-24" value={reason} onChange={(event) => setReason(event.target.value)} required autoFocus aria-describedby="cancel-reason-hint" />
              <span id="cancel-reason-hint" className="mt-1 block text-xs text-muted-foreground">El motivo es obligatorio y queda en el historial.</span>
            </Label>
          </PlatformModal>
        )}
      </Card>
    );
  }

  return null;
}
