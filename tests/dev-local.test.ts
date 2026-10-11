import { describe, expect, test } from "bun:test";
import { buildChildEnv, findRemoteSupabaseUrls, isLocalUrl, parseEnv } from "../scripts/dev-local";

describe("dev-local", () => {
  test("isLocalUrl", () => {
    expect(isLocalUrl("http://127.0.0.1:54321")).toBe(true);
    expect(isLocalUrl("http://localhost:54321")).toBe(true);
    expect(isLocalUrl("https://abc.supabase.co")).toBe(false);
    expect(isLocalUrl("http://127.0.0.1.evil.com")).toBe(false);
    expect(isLocalUrl("no-url")).toBe(false);
    expect(isLocalUrl("http://localhost.evil.com")).toBe(false);
    expect(isLocalUrl("http://localhost@evil.com")).toBe(false);
    expect(isLocalUrl("http://[::1]:54321")).toBe(true);
    expect(isLocalUrl("http://LOCALHOST:54321")).toBe(true);
    expect(isLocalUrl("http://localhost.")).toBe(false);
  });
  test("parseEnv", () => {
    const e = parseEnv('# c\nA=1\nexport B="x=y"\n\nC=\'z\'\r\n');
    expect(e).toEqual({ A: "1", B: "x=y", C: "z" });
  });
  test("findRemoteSupabaseUrls", () => {
    expect(findRemoteSupabaseUrls({ PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321", X: "https://a.com" })).toEqual([]);
    expect(findRemoteSupabaseUrls({ PUBLIC_SUPABASE_URL: "https://a.supabase.co" })).toEqual(["PUBLIC_SUPABASE_URL"]);
  });
  test("findRemoteSupabaseUrls: sin esquema y ws/wss", () => {
    expect(findRemoteSupabaseUrls({ SUPABASE_A: "abc.supabase.co" })).toEqual(["SUPABASE_A"]);
    expect(findRemoteSupabaseUrls({ SUPABASE_A: "abc.supabase.co:443/x" })).toEqual(["SUPABASE_A"]);
    expect(findRemoteSupabaseUrls({ SUPABASE_A: "wss://abc.supabase.co/realtime" })).toEqual(["SUPABASE_A"]);
    expect(findRemoteSupabaseUrls({ SUPABASE_A: "ws://127.0.0.1:54321" })).toEqual([]);
    expect(findRemoteSupabaseUrls({ SUPABASE_A: "localhost:54321" })).toEqual([]);
    expect(findRemoteSupabaseUrls({ SUPABASE_KEY: "eyJhbGciOi.abc.def" })).toEqual([]);
  });
  test("buildChildEnv descarta variables Supabase heredadas", () => {
    const parent = {
      PUBLIC_SUPABASE_URL: "https://prod.supabase.co",
      SUPABASE_FOO: "https://x.supabase.co",
      PATH: "/bin",
    };
    const env = buildChildEnv(parent, { PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321" });
    expect(env.SUPABASE_FOO).toBeUndefined();
    expect(env.PUBLIC_SUPABASE_URL).toBe("http://127.0.0.1:54321");
    expect(env.PATH).toBe("/bin");
    expect(findRemoteSupabaseUrls(env)).toEqual([]);
    expect(Object.values(buildChildEnv(parent, {})).some((v) => v.includes("supabase.co"))).toBe(false);
  });
});
