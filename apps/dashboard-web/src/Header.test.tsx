import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { Header } from "./Header.js";

function renderHeader(): string {
  return renderToStaticMarkup(
    <MemoryRouter>
      <Header discordUsername="yuzuki_nom1" onLogout={() => {}} />
    </MemoryRouter>,
  );
}

describe("Header", () => {
  test("discordUsernameとログアウトボタンを描画する", () => {
    const html = renderHeader();
    expect(html).toContain("yuzuki_nom1");
    expect(html).toContain("Management Bot Dashboard");
    expect(html).toContain("ログアウト");
  });

  test("タイトルはギルド選択画面(トップ)へのリンクになっている", () => {
    const html = renderHeader();
    expect(html).toMatch(/<a[^>]*href="\/"[^>]*>Management Bot Dashboard<\/a>/);
  });
});
