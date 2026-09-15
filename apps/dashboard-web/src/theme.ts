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
 * テーマが"system"の間、OS側の配色設定変更にも追従させる(codexレビュー対応)。
 * "system"以外を選んでいる間は何もしない。呼び出し元はuseEffectのクリーンアップとして
 * 戻り値の解除関数を呼ぶこと。
 */
export function watchSystemTheme(theme: Theme): () => void {
  if (theme !== "system") {
    return () => {};
  }
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  const onChange = () => applyTheme("system");
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}
