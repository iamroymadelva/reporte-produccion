import { useEffect, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDateTime } from "@/lib/format";
import { listenPresence, presenceLabels, presenceStatus, type PresencePayload, type RealtimeClientLike } from "@/lib/realtime";

interface Props {
  /** Operarios activos (id y nombre) cargados por el servidor; los que no están presentes aparecen "Sin conexión". */
  operators: Array<{ id: string; fullName: string }>;
  /** Solo para pruebas. */
  client?: RealtimeClientLike;
}

/**
 * T102: presencia de operarios para managers y auditores. Solo escucha `plant-presence` (nunca hace track). Un operario
 * ausente figura "Sin conexión"; la plataforma no conoce el estado de un dispositivo offline hasta que reconecta.
 */
export default function PresenceList({ operators, client }: Props) {
  const [present, setPresent] = useState<Map<string, PresencePayload>>(new Map());
  const [lastSeen, setLastSeen] = useState<Record<string, string>>({});
  const [unavailable, setUnavailable] = useState(false);
  const previous = useRef<Map<string, PresencePayload>>(new Map());

  useEffect(() => {
    const stop = listenPresence((list) => {
      const next = new Map(list.map((item) => [item.userId, item]));
      // Quien estaba presente y ya no: guardar "última vez".
      const gone: Record<string, string> = {};
      for (const [id, item] of previous.current) if (!next.has(id)) gone[id] = item.lastSeen;
      previous.current = next;
      if (Object.keys(gone).length) setLastSeen((current) => ({ ...current, ...gone }));
      setPresent(next);
    }, {
      client,
      onStatus: (status) => {
        if (status === "SUBSCRIBED") setUnavailable(false);
        else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") setUnavailable(true);
      },
    });
    return stop;
  }, [client]);

  const rows = operators.map((operator) => {
    const info = present.get(operator.id) ?? null;
    return { ...operator, info, status: presenceStatus(info), last: info?.lastSeen ?? lastSeen[operator.id] ?? null };
  }).sort((a, b) => Number(b.status !== "OFFLINE") - Number(a.status !== "OFFLINE") || a.fullName.localeCompare(b.fullName, "es"));

  return (
    <Card className="gap-0 rounded-2xl py-0" data-presence-list>
      <CardHeader className="border-b py-5">
        <CardTitle><h2 className="text-base font-semibold leading-none">Operarios en línea</h2></CardTitle>
        <CardDescription>
          {unavailable ? "La presencia no está disponible por ahora; el resto del tablero sigue actualizándose." : "Estado de conexión de los operarios activos."}
        </CardDescription>
      </CardHeader>
      <CardContent className="p-0">
        {rows.length === 0 ? <p className="p-4 text-sm text-muted-foreground">No hay operarios activos.</p> : (
          <ul className="divide-y" aria-live="polite">
            {rows.map((row) => (
              <li key={row.id} className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm" data-operator-id={row.id} data-presence={row.status}>
                <span className="font-medium">{row.fullName}</span>
                <span className="flex items-center gap-2">
                  {row.status === "OFFLINE" && row.last && <span className="text-xs text-muted-foreground">Última vez {formatDateTime(row.last)}</span>}
                  {row.status === "ONLINE_PENDING" && <span className="text-xs text-muted-foreground">{row.info?.pendingCount} pendientes</span>}
                  <Badge variant={row.status === "OFFLINE" ? "neutral" : row.status === "ONLINE_PENDING" ? "draft" : "submitted"}>{presenceLabels[row.status]}</Badge>
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
