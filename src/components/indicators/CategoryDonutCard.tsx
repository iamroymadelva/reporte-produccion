import { Cell, Pie, PieChart } from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ChartContainer, ChartTooltip, type ChartConfig } from "@/components/ui/chart";
import { Skeleton } from "@/components/ui/skeleton";
import { categoryLabel, formatHours, type IndicatorsCategorySegment } from "@/lib/indicators";

const config = { seconds: { label: "Horas de parada" } } satisfies ChartConfig;
const PALETTE = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)"];
const percent = new Intl.NumberFormat("es-CO", { style: "percent", maximumFractionDigits: 0 });
const formatPercent = (ratio: number) => `${percent.format(ratio).replace(/[\s ]*%$/, "")} %`;

export function CategoryDonutCardSkeleton() {
  return (
    <Card className="rounded-2xl" data-indicators-loading aria-busy="true" aria-label="Cargando gráfica">
      <CardHeader><Skeleton className="h-5 w-48" /></CardHeader>
      <CardContent><Skeleton className="h-[220px] w-full" /></CardContent>
    </Card>
  );
}

export default function CategoryDonutCard({ categories }: { categories: IndicatorsCategorySegment[] }) {
  const total = categories.reduce((sum, s) => sum + s.seconds, 0);
  let position = 0;
  const rows = categories.map((s) => {
    const color = s.kind === "other" ? "var(--muted-foreground)" : PALETTE[position++ % PALETTE.length]!;
    return { label: categoryLabel(s), seconds: s.seconds, color, pct: formatPercent(total > 0 ? s.seconds / total : 0) };
  });
  return (
    <Card className="min-w-0 rounded-2xl" data-chart-card="categories">
      <CardHeader><CardTitle className="text-base">Paradas por categoría</CardTitle></CardHeader>
      <CardContent className="min-w-0">
        {rows.length === 0 || total <= 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground" data-chart-empty>No hay paradas por categoría en este periodo.</p>
        ) : (
          <div className="flex min-w-0 flex-col items-center gap-4">
            <div role="img" aria-label="Gráfica de dona: horas de parada por categoría" className="relative h-[200px] w-full min-w-0 max-w-[240px]">
              <ChartContainer config={config} className="aspect-auto h-full w-full">
                <PieChart>
                  <ChartTooltip
                    cursor={false}
                    content={({ active, payload }) => {
                      const row = payload?.[0]?.payload as (typeof rows)[number] | undefined;
                      if (!active || !row) return null;
                      return (
                        <div className="grid gap-1 rounded-lg border border-border/50 bg-background px-2.5 py-1.5 text-xs shadow-xl">
                          <div className="font-medium">{row.label}</div>
                          <div className="font-mono tabular-nums">{formatHours(row.seconds)} · {row.pct}</div>
                        </div>
                      );
                    }}
                  />
                  <Pie data={rows} dataKey="seconds" nameKey="label" innerRadius={55} outerRadius={85} strokeWidth={2}>
                    {rows.map((row) => <Cell key={row.label} fill={row.color} />)}
                  </Pie>
                </PieChart>
              </ChartContainer>
              <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                <span className="text-lg font-bold tabular-nums">{formatHours(total)}</span>
                <span className="text-xs text-muted-foreground">Total</span>
              </div>
            </div>
            <ul className="w-full min-w-0 space-y-1.5 text-sm" data-category-legend>
              {rows.map((row) => (
                <li key={row.label} className="flex min-w-0 items-center gap-2">
                  <span className="h-2.5 w-2.5 shrink-0 rounded-[2px]" style={{ backgroundColor: row.color }} aria-hidden="true" />
                  <span className="min-w-0 flex-1 truncate">{row.label}</span>
                  <span className="shrink-0 tabular-nums text-muted-foreground">{formatHours(row.seconds)} · {row.pct}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
