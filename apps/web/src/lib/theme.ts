"use client";

/** Light/dark theme, persisted per browser and applied via the `dark` class. */
const KEY = "vertik12.theme";

export type Theme = "light" | "dark";

export function getTheme(): Theme {
  if (typeof window === "undefined") return "light";
  return (localStorage.getItem(KEY) as Theme) ?? "light";
}

export function applyTheme(theme: Theme) {
  document.documentElement.classList.toggle("dark", theme === "dark");
  localStorage.setItem(KEY, theme);
}

/** Call once on mount so a reload keeps the chosen theme. */
export function initTheme() {
  applyTheme(getTheme());
}
