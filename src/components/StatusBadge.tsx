import { Badge } from "@/components/ui/badge";
import { reportStatusVariant } from "../lib/report-status";
import { statusLabels, type ReportStatus } from "../lib/types";

interface Props {
  status: ReportStatus | string;
  className?: string;
}

/** Badge de estado de reporte (En curso / Enviado / Cancelado). Renderizable sin hidratar. */
export default function StatusBadge({ status, className }: Props) {
  return (
    <Badge variant={reportStatusVariant(status)} className={className}>
      {statusLabels[status as ReportStatus] ?? status}
    </Badge>
  );
}
