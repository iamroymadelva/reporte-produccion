import { describe, expect, test } from "bun:test";
import { decodeNotificationCursor, encodeNotificationCursor, hasAllowedMutationOrigin, isTimestamp, isUuid } from "../src/lib/notifications";

describe("notification API cursor", () => {
  const cursor = {
    snapshotAt: "2026-10-08T12:00:00.000Z",
    createdAt: "2026-10-08T11:59:59.000Z",
    id: "11111111-1111-4111-8111-111111111111",
  };

  test("round trips an opaque keyset cursor", () => {
    expect(decodeNotificationCursor(encodeNotificationCursor(cursor))).toEqual(cursor);
  });

  test("rejects malformed, future and non-UUID cursors", () => {
    expect(decodeNotificationCursor("bad cursor")).toBeNull();
    expect(decodeNotificationCursor(btoa(JSON.stringify({ ...cursor, createdAt: "2026-10-09T00:00:00Z" })))).toBeNull();
    expect(decodeNotificationCursor(btoa(JSON.stringify({ ...cursor, id: "nope" })))).toBeNull();
    expect(decodeNotificationCursor(btoa(JSON.stringify({ ...cursor, snapshotAt: "2099-01-01T00:00:00Z" })))).toBeNull();
  });

  test("validates timestamps and identifiers before database calls", () => {
    expect(isTimestamp("2026-10-08T12:00:00Z")).toBe(true);
    expect(isTimestamp("2026-99-08T12:00:00Z")).toBe(false);
    expect(isTimestamp("2026-02-30T12:00:00Z")).toBe(false);
    expect(isTimestamp("2024-02-29T12:00:00.123456+00:00")).toBe(true);
    expect(isUuid(cursor.id)).toBe(true);
    expect(isUuid("not-an-id")).toBe(false);
  });

  test("rejects cross-origin mutation requests", () => {
    expect(hasAllowedMutationOrigin(new Request("https://app.example/api/notifications/read-all", {
      method: "POST", headers: { Origin: "https://other.example" },
    }))).toBe(false);
    expect(hasAllowedMutationOrigin(new Request("https://app.example/api/notifications/read-all", {
      method: "POST", headers: { Origin: "https://app.example" },
    }))).toBe(true);
  });
});
