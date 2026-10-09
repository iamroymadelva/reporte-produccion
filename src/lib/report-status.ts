import { isActiveStop, type StopEvent } from "./stop-events";
import type { ReportStatus } from "./types";

export type ReportStatusVariant = "draft" | "submitted" | "cancelled";

/** Maps a report status to the matching Badge variant. Unknown values fall back to "submitted". */
export function reportStatusVariant(status: ReportStatus | string | null | undefined): ReportStatusVariant {
  if (status === "DRAFT") return "draft";
  if (status === "CANCELLED") return "cancelled";
  return "submitted";
}

type StopLike = Pick<StopEvent, "ended_at" | "cancelled_at">;

/** True when the report has at least one stop that is neither closed nor cancelled. */
export function hasActiveStop(report: { report_stop_events?: StopLike[] | null } | null | undefined) {
  return Boolean(report?.report_stop_events?.some(isActiveStop));
}

export const STOP_ACTIVE_LABEL = "Parada activa";
export const STOP_IDLE_LABEL = "En operación";
