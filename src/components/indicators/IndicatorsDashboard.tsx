import { useCallback, useEffect, useRef, useState } from "react";
import IndicatorCards, { IndicatorCardsSkeleton } from "./IndicatorCards";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";
import {
  DEFAULT_INDICATORS_RANGE, INDICATOR_RANGES, isIndicatorsRangeKey,
  type IndicatorsRangeKey, type IndicatorsResponse,
} from "@/lib/indicators";

type Status = "loading" | "ready" | "error";

export default function IndicatorsDashboard() {
  const [range, setRange] = useState<IndicatorsRangeKey>(DEFAULT_INDICATORS_RANGE);
  const [status, setStatus] = useState<Status>("loading");
  const [data, setData] = useState<IndicatorsResponse | null>(null);
  const [attempt, setAttempt] = useState(0);
  const latest = useRef<AbortController | null>(null);

  useEffect(() => {
    latest.current?.abort();
    const controller = new AbortController();
    latest.current = controller;
    setStatus("loading");
    (async () => {
      try {
        const response = await fetch(`/api/indicadores?rango=${range}`, { signal: controller.signal, headers: { accept: "application/json" } });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const body = (await response.json()) as IndicatorsResponse;
        if (controller.signal.aborted) return;
        setData(body);
        setStatus("ready");
      } catch {
        if (controller.signal.aborted) return;
        setStatus("error");
      }
    })();
    return () => controller.abort();
  }, [range, attempt]);

  const retry = useCallback(() => setAttempt((value) => value + 1), []);

  return (
    <div className="space-y-6">
      <div className="flex justify-end">
        <div className="w-full sm:w-56">
          <label htmlFor="indicators-range" className="sr-only">Rango de fechas</label>
          <NativeSelect id="indicators-range" value={range} onChange={(event) => { if (isIndicatorsRangeKey(event.target.value)) setRange(event.target.value); }}>
            {(Object.keys(INDICATOR_RANGES) as IndicatorsRangeKey[]).map((key) => (
              <option key={key} value={key}>{INDICATOR_RANGES[key].label}</option>
            ))}
          </NativeSelect>
        </div>
      </div>

      {status === "error" ? (
        <Alert variant="destructive" data-indicators-error>
          <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
            <span>No fue posible cargar los indicadores. Intenta nuevamente.</span>
            <Button type="button" variant="outline" size="sm" onClick={retry}>Reintentar</Button>
          </AlertDescription>
        </Alert>
      ) : status === "loading" || !data ? (
        <IndicatorCardsSkeleton />
      ) : (
        <IndicatorCards cards={data.cards} />
      )}

      {/* Slots para las gráficas de US2 (parada por día/máquina) y US3 (categorías). */}
      <div data-slot="indicators-daily-chart" />
      <div data-slot="indicators-breakdown-charts" />
    </div>
  );
}
