import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ChartContainer, ChartTooltip, type ChartConfig } from "@/components/ui/chart";
import { Skeleton } from "@/components/ui/skeleton";
import { formatHours, secondsToHours, type IndicatorsMachine } from "@/lib/indicators";

const config = { hours: { label: "Horas de parada", color: "var(--chart-2)" } } satisfies ChartConfig;
const ROW = 36;

export function MachineBarCardSkeleton() {
  return (
    <Card className="rounded-2xl" data-indicators-loading aria-busy="true" aria-label="Cargando gráfica">
      <CardHeader><Skeleton className="h-5 w-48" /></CardHeader>
      <CardContent><Skeleton className="h-[220px] w-full" /></CardContent>
    </Card>
  );
}

export default function MachineBarCard({ machines }: { machines: IndicatorsMachine[] }) {
  const data = machines.map((m) => ({ code: m.code, name: m.name, hours: secondsToHours(m.seconds), seconds: m.seconds }));
  return (
    <Card className="min-w-0 rounded-2xl" data-chart-card="machines">
      <CardHeader><CardTitle className="text-base">Horas de parada por máquina</CardTitle></CardHeader>
      <CardContent className="min-w-0">
        {data.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground" data-chart-empty>No hay paradas por máquina en este periodo.</p>
        ) : (
          <div role="img" aria-label="Gráfica de barras: horas de parada por máquina" className="min-w-0">
            <ChartContainer config={config} className="aspect-auto w-full min-w-0" style={{ height: Math.max(120, data.length * ROW + 32) }}>
              <BarChart data={data} layout="vertical" margin={{ left: 0, right: 12 }}>
                <CartesianGrid horizontal={false} />
                <YAxis dataKey="code" type="category" tickLine={false} axisLine={false} width={64} tickFormatter={(v: string) => (v.length > 9 ? `${v.slice(0, 8)}…` : v)} />
                <XAxis type="number" hide />
                <ChartTooltip
                  cursor={false}
                  content={({ active, payload }) => {
                    const row = payload?.[0]?.payload as (typeof data)[number] | undefined;
                    if (!active || !row) return null;
                    return (
                      <div className="grid gap-1 rounded-lg border border-border/50 bg-background px-2.5 py-1.5 text-xs shadow-xl">
                        <div className="font-medium">{row.code} — {row.name}</div>
                        <div className="font-mono tabular-nums">{formatHours(row.seconds)}</div>
                      </div>
                    );
                  }}
                />
                <Bar dataKey="hours" fill="var(--chart-2)" radius={4} />
              </BarChart>
            </ChartContainer>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
