export type StopEvent = {
  id: string;
  started_at: string;
  ended_at: string | null;
  duration_seconds: number | null;
  description: string | null;
  cancelled_at: string | null;
  cancellation_reason: string | null;
  stop_category: { id: string; code: string; name: string } | null;
};

export const STOP_EVENT_SELECTION = "id, started_at, ended_at, duration_seconds, description, cancelled_at, cancellation_reason, stop_category:stop_categories(id, code, name)";
export const REPORT_STOPS_CHANGED = "report:stops-changed";

export function isActiveStop(stop: Pick<StopEvent, "ended_at" | "cancelled_at">) {
  return !stop.ended_at && !stop.cancelled_at;
}

export function summarizeClosedStops(stops: Pick<StopEvent, "ended_at" | "cancelled_at" | "duration_seconds">[]) {
  return stops.reduce((summary, stop) => {
    if (stop.ended_at && !stop.cancelled_at && stop.duration_seconds !== null) {
      summary.count += 1;
      summary.seconds += Number(stop.duration_seconds);
    }
    return summary;
  }, { count: 0, seconds: 0 });
}

export function stopDuration(seconds: number) {
  return [Math.floor(seconds / 3600), Math.floor((seconds % 3600) / 60), seconds % 60]
    .map((part) => String(part).padStart(2, "0")).join(":");
}
