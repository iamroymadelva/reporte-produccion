import { useCallback, useSyncExternalStore } from "react";

export type Theme = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

const STORAGE_KEY = "theme";
const THEME_EVENT = "themechange";
const META_COLORS: Record<ResolvedTheme, string> = { light: "#172554", dark: "#0a1023" };

export function getStoredTheme(): Theme {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    if (value === "light" || value === "dark" || value === "system") return value;
  } catch {
    // localStorage no disponible
  }
  return "system";
}

export function resolveTheme(theme: Theme = getStoredTheme()): ResolvedTheme {
  if (theme === "system") {
    try {
      return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    } catch {
      return "light";
    }
  }
  return theme;
}

export function applyTheme(theme: Theme): void {
  try {
    const resolved = resolveTheme(theme);
    const root = document.documentElement;
    root.classList.toggle("dark", resolved === "dark");
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute("content", META_COLORS[resolved]);
    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      // ignorar
    }
    window.dispatchEvent(new CustomEvent(THEME_EVENT));
  } catch {
    // ignorar
  }
}

export function toggleTheme(): void {
  applyTheme(resolveTheme() === "dark" ? "light" : "dark");
}

function subscribe(callback: () => void): () => void {
  window.addEventListener(THEME_EVENT, callback);
  window.addEventListener("storage", callback);
  const media = window.matchMedia?.("(prefers-color-scheme: dark)");
  const observer = new MutationObserver(callback);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
  const onMedia = () => {
    if (getStoredTheme() === "system") applyTheme("system");
    callback();
  };
  media?.addEventListener?.("change", onMedia);
  return () => {
    window.removeEventListener(THEME_EVENT, callback);
    window.removeEventListener("storage", callback);
    observer.disconnect();
    media?.removeEventListener?.("change", onMedia);
  };
}

const getResolvedSnapshot = (): ResolvedTheme =>
  document.documentElement.classList.contains("dark") ? "dark" : "light";
const getServerSnapshot = (): ResolvedTheme => "light";
const getThemeSnapshot = (): Theme => getStoredTheme();
const getServerThemeSnapshot = (): Theme => "system";

export function useTheme(): {
  theme: Theme;
  resolvedTheme: ResolvedTheme;
  setTheme: (theme: Theme) => void;
} {
  const resolvedTheme = useSyncExternalStore(subscribe, getResolvedSnapshot, getServerSnapshot);
  const theme = useSyncExternalStore(subscribe, getThemeSnapshot, getServerThemeSnapshot);
  const setTheme = useCallback((next: Theme) => applyTheme(next), []);
  return { theme, resolvedTheme, setTheme };
}
