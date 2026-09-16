import { stopDuration, summarizeClosedStops, type StopEvent } from "../lib/stop-events";

export default function StopSummary({ stops }: { stops: StopEvent[] }) {
  const summary = summarizeClosedStops(stops);
  return (
    <div className="flex flex-wrap gap-x-6 gap-y-2 font-semibold" aria-live="polite">
      <p>Número de paradas: {summary.count}</p>
      <p>Tiempo total de parada: <span className="font-mono tabular-nums">{stopDuration(summary.seconds)}</span></p>
    </div>
  );
}
