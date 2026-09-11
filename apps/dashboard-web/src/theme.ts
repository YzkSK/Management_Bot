export type Theme = "light" | "dark" | "system";

const STORAGE_KEY = "theme";
const THEMES: readonly Theme[] = ["light", "dark", "system"];

function prefersDark(): boolean {
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

export function getStoredTheme(): Theme {
  if (typeof localStorage === "undefined") {
    return "system";
  }
  const stored = localStorage.getItem(STORAGE_KEY);
  return THEMES.includes(stored as Theme) ? (stored as Theme) : "system";
}

export function applyTheme(theme: Theme): void {
  const isDark = theme === "dark" || (theme === "system" && prefersDark());
  document.documentElement.classList.toggle("dark", isDark);
}

export function setTheme(theme: Theme): void {
  localStorage.setItem(STORAGE_KEY, theme);
  applyTheme(theme);
}
