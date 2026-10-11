export type NotificationItem = {
  id: string;
  type: "REPORT_SUBMITTED" | "REPORT_CANCELLED" | "REPORT_CORRECTED" | "ASSIGNMENTS_CHANGED" | "STOP_STARTED"
    | "REPORT_APPROVED" | "SYNC_CONFLICT" | "OFFLINE_DATA_REVIEW" | "CLOCK_SKEW_REVIEW";
  resourceType: "report" | "stop" | "assignment";
  resourceId: string;
  actorId: string | null;
  stopStatus: "OPEN" | "CLOSED" | "CANCELLED" | null;
  title: string;
  body: string;
  href: string;
  createdAt: string;
  updatedAt: string;
  readAt: string | null;
};

export type NotificationsPage = {
  items: NotificationItem[];
  unreadCount: number;
  nextCursor: string | null;
  snapshotAt: string;
};

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && uuid.test(value);
}

export function hasAllowedMutationOrigin(request: Request): boolean {
  const origin = request.headers.get("Origin");
  if (!origin) return true;
  try { return new URL(origin).origin === new URL(request.url).origin; }
  catch { return false; }
}

export function isTimestamp(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match = /^(\d{4})-(\d\d)-(\d\d)T(\d\d):(\d\d):(\d\d)(?:\.\d{1,6})?(?:Z|([+-])(\d\d):(\d\d))$/.exec(value);
  if (!match) return false;
  const [, yearText, monthText, dayText, hourText, minuteText, secondText, , offsetHourText, offsetMinuteText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const calendarDate = new Date(Date.UTC(year, month - 1, day));
  return calendarDate.getUTCFullYear() === year && calendarDate.getUTCMonth() + 1 === month
    && calendarDate.getUTCDate() === day && Number(hourText) <= 23 && Number(minuteText) <= 59
    && Number(secondText) <= 59 && (!offsetHourText || (Number(offsetHourText) <= 14 && Number(offsetMinuteText) <= 59))
    && Number.isFinite(Date.parse(value));
}

export type NotificationCursor = { snapshotAt: string; createdAt: string; id: string };

export function encodeNotificationCursor(cursor: NotificationCursor): string {
  return btoa(JSON.stringify(cursor)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function decodeNotificationCursor(raw: string): NotificationCursor | null {
  if (!/^[A-Za-z0-9_-]{1,512}$/.test(raw)) return null;
  try {
    const cursor: unknown = JSON.parse(atob(raw.replace(/-/g, "+").replace(/_/g, "/")));
    if (!cursor || typeof cursor !== "object") return null;
    const value = cursor as Record<string, unknown>;
    if (!isTimestamp(value.snapshotAt) || !isTimestamp(value.createdAt) || !isUuid(value.id)) return null;
    if (Date.parse(value.snapshotAt) > Date.now() + 60_000) return null;
    if (Date.parse(value.createdAt) > Date.parse(value.snapshotAt)) return null;
    return { snapshotAt: value.snapshotAt, createdAt: value.createdAt, id: value.id };
  } catch {
    return null;
  }
}
