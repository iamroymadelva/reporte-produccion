import { useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { FieldLabel, Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import PlatformModal from "./PlatformModal";

export const CORRECTION_REASON_MIN_LENGTH = 5;

export type CorrectionSummaryItem = { field: string; label: string; previous: string; next: string };

interface Props {
  changes: CorrectionSummaryItem[];
  busy?: boolean;
  error?: string;
  onCancel: () => void;
  onConfirm: (reason: string) => void;
}

/** Diálogo de corrección de un reporte enviado o cerrado: resumen de campos cambiados y motivo obligatorio. */
export default function CorrectionDialog({ changes, busy = false, error, onCancel, onConfirm }: Props) {
  const [reason, setReason] = useState("");
  const trimmed = reason.trim();
  const valid = trimmed.length >= CORRECTION_REASON_MIN_LENGTH;

  return (
    <PlatformModal
      title="Corregir reporte"
      confirmLabel={busy ? "Guardando…" : "Guardar corrección"}
      confirmDisabled={!valid || busy || changes.length === 0}
      onCancel={onCancel}
      onConfirm={() => { if (valid && !busy) onConfirm(trimmed); }}
    >
      <p className="text-sm text-muted-foreground">
        La corrección queda registrada en el historial con tu nombre, tu rol y el motivo.
      </p>
      <ul className="mt-4 max-h-56 space-y-2 overflow-y-auto text-sm" aria-label="Campos que cambian">
        {changes.map((change) => (
          <li key={change.field} className="rounded-lg bg-muted/60 p-3">
            <p className="font-semibold text-foreground">{change.label}</p>
            <p className="mt-1 break-words text-muted-foreground">
              <span className="line-through">{change.previous}</span>
              {" → "}
              <span className="font-semibold text-foreground">{change.next}</span>
            </p>
          </li>
        ))}
        {changes.length === 0 && <li className="text-muted-foreground">No hay cambios por guardar.</li>}
      </ul>
      <Label className="mt-5">
        <FieldLabel>Motivo de la corrección (obligatorio)</FieldLabel>
        <Textarea
          className="min-h-24"
          value={reason}
          disabled={busy}
          onChange={(event) => setReason(event.target.value)}
          placeholder={`Mínimo ${CORRECTION_REASON_MIN_LENGTH} caracteres`}
          required
          autoFocus
          aria-describedby="correction-reason-hint"
          aria-invalid={reason.length > 0 && !valid ? true : undefined}
        />
        <span id="correction-reason-hint" className={`mt-1 block text-xs ${reason.length > 0 && !valid ? "font-semibold text-destructive-text" : "text-muted-foreground"}`}>
          Escribe al menos {CORRECTION_REASON_MIN_LENGTH} caracteres para guardar.
        </span>
      </Label>
      {error && (
        <Alert variant="destructive" role="alert" className="mt-4">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
    </PlatformModal>
  );
}
