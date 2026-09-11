import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { applyTheme, getStoredTheme, setTheme } from "./theme.js";

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

beforeEach(() => {
  matchesDark = false;
  toggleDark = mock();
  Object.defineProperty(globalThis, "localStorage", { value: mockLocalStorage(), configurable: true });
  Object.defineProperty(globalThis, "window", {
    value: { matchMedia: () => ({ matches: matchesDark }) },
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
