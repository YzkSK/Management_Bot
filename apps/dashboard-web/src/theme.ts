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

/**
 * OS側の配色設定が変わったら、その時点で保存されているテーマを適用し直す(codexレビュー対応)。
 * "system"以外を選んでいる間は再適用しても見た目は変わらない。アプリ起動時に一度だけ呼ぶ。
 * 戻り値は解除関数。
 */
export function followSystemTheme(): () => void {
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  const onChange = () => applyTheme(getStoredTheme());
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}
