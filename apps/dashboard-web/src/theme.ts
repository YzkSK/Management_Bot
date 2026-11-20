export type Theme = "light" | "dark" | "system";

// StarwindのテーマのinitスクリプトもこのキーのlocalStorageを読む。
const STORAGE_KEY = "colorTheme";
const LEGACY_STORAGE_KEY = "theme";

function isTheme(v: unknown): v is Theme {
  return v === "light" || v === "dark" || v === "system";
}

function prefersDark(): boolean {
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

export function getStoredTheme(): Theme {
  if (typeof localStorage === "undefined") {
    return "system";
  }
  const stored = localStorage.getItem(STORAGE_KEY);
  return isTheme(stored) ? stored : "system";
}

/**
 * 旧キー`theme`に有効値があれば`colorTheme`へ一度だけ移し、旧キーを削除する。
 * Starwindのinitスクリプトは移行より先に走り`colorTheme`未設定時に"system"を書き込むため、
 * 旧キーが残っている間は旧キーの値を優先して上書きする。旧ユーザーは初回のみsystemで描画される(許容)。
 */
export function migrateLegacyThemeKey(): void {
  if (typeof localStorage === "undefined") {
    return;
  }
  const legacy = localStorage.getItem(LEGACY_STORAGE_KEY);
  if (legacy === null) {
    return;
  }
  if (isTheme(legacy)) {
    localStorage.setItem(STORAGE_KEY, legacy);
  }
  localStorage.removeItem(LEGACY_STORAGE_KEY);
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
