import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { applyTheme, getStoredTheme, setTheme, watchSystemTheme } from "./theme.js";

function mockLocalStorage(): Storage {
  const store = new Map<string, string>();
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key),
    clear: () => store.clear(),
    key: () => null,
    get length() {
      return store.size;
    },
  };
}

let toggleDark: ReturnType<typeof mock>;
let matchesDark: boolean;
let mediaListeners: Array<() => void>;
let addEventListener: ReturnType<typeof mock>;
let removeEventListener: ReturnType<typeof mock>;

beforeEach(() => {
  matchesDark = false;
  toggleDark = mock();
  mediaListeners = [];
  addEventListener = mock((_event: string, listener: () => void) => void mediaListeners.push(listener));
  removeEventListener = mock((_event: string, listener: () => void) => {
    mediaListeners = mediaListeners.filter((l) => l !== listener);
  });
  Object.defineProperty(globalThis, "localStorage", { value: mockLocalStorage(), configurable: true });
  Object.defineProperty(globalThis, "window", {
    value: { matchMedia: () => ({ matches: matchesDark, addEventListener, removeEventListener }) },
    configurable: true,
  });
  Object.defineProperty(globalThis, "document", {
    value: { documentElement: { classList: { toggle: toggleDark } } },
    configurable: true,
  });
});

afterEach(() => {
  // @ts-expect-error テスト用に注入したグローバルを元に戻す
  delete globalThis.localStorage;
  // @ts-expect-error テスト用に注入したグローバルを元に戻す
  delete globalThis.window;
  // @ts-expect-error テスト用に注入したグローバルを元に戻す
  delete globalThis.document;
});

describe("getStoredTheme", () => {
  test("未保存の場合はsystemを返す", () => {
    expect(getStoredTheme()).toBe("system");
  });

  test("保存済みの有効な値を返す", () => {
    localStorage.setItem("theme", "dark");
    expect(getStoredTheme()).toBe("dark");
  });

  test("不正な値が保存されていた場合はsystemにフォールバックする", () => {
    localStorage.setItem("theme", "invalid");
    expect(getStoredTheme()).toBe("system");
  });
});

describe("applyTheme", () => {
  test("darkを指定した場合はdarkクラスを付与する", () => {
    applyTheme("dark");
    expect(toggleDark).toHaveBeenCalledWith("dark", true);
  });

  test("lightを指定した場合はdarkクラスを外す", () => {
    applyTheme("light");
    expect(toggleDark).toHaveBeenCalledWith("dark", false);
  });

  test("systemを指定した場合はprefers-color-schemeに従う", () => {
    matchesDark = true;
    applyTheme("system");
    expect(toggleDark).toHaveBeenCalledWith("dark", true);
  });
});

describe("setTheme", () => {
  test("localStorageに保存しつつ即座に適用する", () => {
    setTheme("dark");
    expect(localStorage.getItem("theme")).toBe("dark");
    expect(toggleDark).toHaveBeenCalledWith("dark", true);
  });
});

describe("watchSystemTheme(codexレビュー対応: OS配色設定の変更への追従)", () => {
  test("system以外では購読せず、解除関数は何もしない", () => {
    const unwatch = watchSystemTheme("dark");
    expect(addEventListener).not.toHaveBeenCalled();
    expect(() => unwatch()).not.toThrow();
  });

  test("system選択中はOS設定変更(change)のたびにdarkクラスを再適用する", () => {
    watchSystemTheme("system");
    expect(addEventListener).toHaveBeenCalledTimes(1);

    matchesDark = true;
    mediaListeners.forEach((listener) => listener());

    expect(toggleDark).toHaveBeenCalledWith("dark", true);
  });

  test("解除関数を呼ぶとリスナーが外れる", () => {
    const unwatch = watchSystemTheme("system");
    unwatch();

    expect(removeEventListener).toHaveBeenCalledTimes(1);
  });
});
