import { useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { FieldLabel, Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import PlatformModal from "./PlatformModal";
import { guardedMutationFetch } from "../lib/connectivity";
import { formatDateTime } from "../lib/format";
import type { QuarantineItem } from "../lib/sync-quarantine";

interface Props {
  items: QuarantineItem[];
}

/** Datos capturados sin conexión en revisión: el coordinador los marca revisados o los aplica con motivo. */
export default function QuarantineReviewPanel({ items }: Props) {
  const [target, setTarget] = useState<{ item: QuarantineItem; apply: boolean } | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = async () => {
    if (!target) return;
    setBusy(true);
    setError("");
    try {
      const response = await guardedMutationFetch(`/api/sync-quarantine/${target.item.id}/review`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apply: target.apply, reason: reason.trim() || undefined }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? "No fue posible completar la revisión.");
      window.location.reload();
    } catch (cause) {
      setBusy(false);
      setTarget(null);
      setError(cause instanceof Error ? cause.message : "No fue posible completar la revisión.");
    }
  };

  return (
    <Card className="rounded-2xl gap-3 border-warning/40 p-5" aria-labelledby="quarantine-title">
      <div>
        <h2 id="quarantine-title" className="text-base font-semibold leading-none">Datos capturados sin conexión en revisión</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Mientras haya elementos sin revisar el reporte no se puede aprobar. Marca como revisado para conservar el valor del servidor
          o aplica los datos indicando un motivo.
        </p>
      </div>
      <Alert variant="warning" role="note">
        <AlertDescription>
          Los datos marcados como capturados sin conexión llevan la hora del dispositivo del operario, que puede estar mal
          configurada: revisa las horas con criterio antes de aplicarlos.
        </AlertDescription>
      </Alert>
      {error && <Alert variant="destructive" role="alert"><AlertDescription>{error}</AlertDescription></Alert>}
      <ul className="space-y-3">
        {items.map((item) => (
          <li key={item.id} className="rounded-xl bg-muted/50 p-4 text-sm">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <p className="font-bold text-foreground">{item.operationLabel}</p>
              <Badge variant="outline">{item.reasonLabel}</Badge>
            </div>
            {item.detail && <p className="mt-1 break-words text-foreground">{item.detail}</p>}
            <p className="mt-1 text-muted-foreground">
              Capturado: {item.capturedAt ? formatDateTime(item.capturedAt) : "—"} · Recibido: {formatDateTime(item.receivedAt)}
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button variant="outline" size="lg" type="button" disabled={busy}
                onClick={() => { setReason(""); setTarget({ item, apply: false }); }}>
                Marcar revisado
              </Button>
              {item.applicable && (
                <Button size="lg" type="button" disabled={busy}
                  onClick={() => { setReason(""); setTarget({ item, apply: true }); }}>
                  Aplicar con motivo
                </Button>
              )}
            </div>
          </li>
        ))}
      </ul>
      {target && (
        <PlatformModal
          title={target.apply ? "Aplicar los datos al reporte" : "Marcar como revisado"}
          confirmLabel={target.apply ? "Aplicar datos" : "Marcar revisado"}
          confirmDisabled={busy || (target.apply && reason.trim().length < 5)}
          onCancel={() => setTarget(null)}
          onConfirm={() => void submit()}
        >
          <p>
            {target.apply
              ? "Los datos se aplicarán como una corrección del reporte y quedarán en el historial con tu motivo."
              : "Se conserva el valor del servidor y el elemento deja de bloquear la aprobación."}
          </p>
          <Label className="mt-5">
            <FieldLabel>{target.apply ? "Motivo (mínimo 5 caracteres)" : "Nota (opcional)"}</FieldLabel>
            <Textarea className="min-h-24" value={reason} onChange={(event) => setReason(event.target.value)} autoFocus />
          </Label>
        </PlatformModal>
      )}
    </Card>
  );
}
