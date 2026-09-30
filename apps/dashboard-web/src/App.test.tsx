import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { AppStateScreen } from "./App.js";

describe("AppStateScreen", () => {
  test("起動中はスピナーと読み込み中を出す", () => {
    const html = renderToStaticMarkup(<AppStateScreen view="boot" />);
    expect(html).toContain("Management Bot");
    expect(html).toContain("読み込み中...");
    expect(html).toContain("animate-spin");
  });

  test("未ログインはリダイレクト文言とログインへのリンクを出す", () => {
    const html = renderToStaticMarkup(<AppStateScreen view="redirect" />);
    expect(html).toContain("Discordのログイン画面へ移動しています...");
    expect(html).toMatch(/href="[^"]*\/auth\/login"/);
  });

  test("接続失敗はalertと再読み込みボタンを出す", () => {
    const html = renderToStaticMarkup(<AppStateScreen view="error" />);
    expect(html).toContain('role="alert"');
    expect(html).toContain("再読み込み");
    expect(html).not.toContain("animate-spin");
  });
});
