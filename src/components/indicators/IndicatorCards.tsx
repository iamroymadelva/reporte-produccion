import type { ReactNode } from "react";
import { CheckCircle2, Clock, FileText, OctagonAlert } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { formatAvgApprovalHours, formatHours, formatRatioPercent, type IndicatorsCards } from "@/lib/indicators";

const GRID = "grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4";

function IndicatorCard({ id, title, icon, value, description }: { id: string; title: string; icon: ReactNode; value: string; description: string }) {
  return (
    <Card className="rounded-2xl gap-0 py-4" data-indicator={id}>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium leading-snug">{title}</CardTitle>
        {icon}
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold tabular-nums" data-indicator-value>{value}</div>
        <CardDescription className="mt-1 text-xs">{description}</CardDescription>
      </CardContent>
    </Card>
  );
}

export function IndicatorCardsSkeleton() {
  return (
    <div className={GRID} data-indicators-loading aria-busy="true" aria-label="Cargando indicadores">
      {Array.from({ length: 4 }, (_, index) => (
        <Card key={index} className="rounded-2xl gap-0 py-4">
          <CardHeader className="pb-2"><Skeleton className="h-4 w-32" /></CardHeader>
          <CardContent className="space-y-2"><Skeleton className="h-8 w-20" /><Skeleton className="h-3 w-40" /></CardContent>
        </Card>
      ))}
    </div>
  );
}

export default function IndicatorCards({ cards }: { cards: IndicatorsCards }) {
  const icon = "h-4 w-4 shrink-0";
  return (
    <section className={GRID} aria-label="Indicadores del periodo">
      <IndicatorCard id="reports" title="Reportes del periodo" icon={<FileText className={`${icon} text-primary`} aria-hidden="true" />}
        value={String(cards.reports)} description="Reportes con fecha operativa en el rango" />
      <IndicatorCard id="approved" title="Reportes aprobados" icon={<CheckCircle2 className={`${icon} text-success-text`} aria-hidden="true" />}
        value={formatRatioPercent(cards.approvedRatio)} description={`${cards.approved} de ${cards.reports} reportes`} />
      <IndicatorCard id="approval-time" title="Tiempo hasta aprobación" icon={<Clock className={`${icon} text-warning-text`} aria-hidden="true" />}
        value={formatAvgApprovalHours(cards.avgApprovalSeconds)} description="Promedio desde el fin del turno" />
      <IndicatorCard id="stops" title="Horas de parada" icon={<OctagonAlert className={`${icon} text-stop-text`} aria-hidden="true" />}
        value={formatHours(cards.stopSeconds)} description="Tiempo total de paradas en el periodo" />
    </section>
  );
}
