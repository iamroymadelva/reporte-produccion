import { Area, AreaChart, CartesianGrid, XAxis } from "recharts";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ChartContainer, ChartTooltip, type ChartConfig } from "@/components/ui/chart";
import { Skeleton } from "@/components/ui/skeleton";
import { formatHours, secondsToHours, type IndicatorsDailyPoint } from "@/lib/indicators";

const config = { hours: { label: "Horas de parada", color: "var(--chart-1)" } } satisfies ChartConfig;

const toDate = (key: string) => new Date(`${key}T12:00:00Z`);
const shortFormat = new Intl.DateTimeFormat("es-CO", { day: "numeric", month: "short", timeZone: "UTC" });
const longFormat = new Intl.DateTimeFormat("es-CO", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
const shortDate = (key: string) => shortFormat.format(toDate(key)).replace(/\./g, "");
const longDate = (key: string) => longFormat.format(toDate(key));

export function AreaChartCardSkeleton() {
  return (
    <Card className="rounded-2xl" data-indicators-loading aria-busy="true" aria-label="Cargando gráfica">
      <CardHeader><Skeleton className="h-5 w-48" /><Skeleton className="h-3 w-32" /></CardHeader>
      <CardContent><Skeleton className="h-[220px] w-full" /></CardContent>
    </Card>
  );
}

export default function AreaChartCard({ daily, description }: { daily: IndicatorsDailyPoint[]; description?: string }) {
  const hasData = daily.some((point) => point.seconds > 0);
  const data = daily.map((point) => ({ date: point.date, hours: secondsToHours(point.seconds), seconds: point.seconds }));
  return (
    <Card className="min-w-0 rounded-2xl" data-chart-card="daily">
      <CardHeader>
        <CardTitle className="text-base">Horas de parada por día</CardTitle>
        {description ? <CardDescription>{description}</CardDescription> : null}
      </CardHeader>
      <CardContent className="min-w-0">
        {!hasData ? (
          <p className="py-10 text-center text-sm text-muted-foreground" data-chart-empty>No hay paradas registradas en este periodo.</p>
        ) : (
          <div role="img" aria-label="Gráfica de área: horas de parada por día en el periodo" className="min-w-0">
            <ChartContainer config={config} className="aspect-auto h-[220px] w-full min-w-0">
              <AreaChart data={data} margin={{ left: 12, right: 12 }}>
                <defs>
                  <linearGradient id="fillStopHours" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="var(--chart-1)" stopOpacity={0.8} />
                    <stop offset="95%" stopColor="var(--chart-1)" stopOpacity={0.1} />
                  </linearGradient>
                </defs>
                <CartesianGrid vertical={false} />
                <XAxis dataKey="date" tickLine={false} axisLine={false} tickMargin={8} minTickGap={32} tickFormatter={shortDate} />
                <ChartTooltip
                  cursor={false}
                  content={({ active, payload }) => {
                    const point = payload?.[0]?.payload as { date: string; seconds: number } | undefined;
                    if (!active || !point) return null;
                    return (
                      <div className="grid gap-1 rounded-lg border border-border/50 bg-background px-2.5 py-1.5 text-xs shadow-xl">
                        <div className="font-medium capitalize">{longDate(point.date)}</div>
                        <div className="font-mono tabular-nums">{formatHours(point.seconds)}</div>
                      </div>
                    );
                  }}
                />
                <Area dataKey="hours" type="monotone" fill="url(#fillStopHours)" stroke="var(--chart-1)" />
              </AreaChart>
            </ChartContainer>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
