import { describe, expect, test } from "bun:test";
import { findRemoteSupabaseUrls, isLocalUrl, parseEnv } from "../scripts/dev-local";

describe("dev-local", () => {
  test("isLocalUrl", () => {
    expect(isLocalUrl("http://127.0.0.1:54321")).toBe(true);
    expect(isLocalUrl("http://localhost:54321")).toBe(true);
    expect(isLocalUrl("https://abc.supabase.co")).toBe(false);
    expect(isLocalUrl("http://127.0.0.1.evil.com")).toBe(false);
    expect(isLocalUrl("no-url")).toBe(false);
  });
  test("parseEnv", () => {
    const e = parseEnv('# c\nA=1\nexport B="x=y"\n\nC=\'z\'\r\n');
    expect(e).toEqual({ A: "1", B: "x=y", C: "z" });
  });
  test("findRemoteSupabaseUrls", () => {
    expect(findRemoteSupabaseUrls({ PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321", X: "https://a.com" })).toEqual([]);
    expect(findRemoteSupabaseUrls({ PUBLIC_SUPABASE_URL: "https://a.supabase.co" })).toEqual(["PUBLIC_SUPABASE_URL"]);
  });
});
