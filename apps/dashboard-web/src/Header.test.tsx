import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { Header } from "./Header.js";

function renderHeader(avatarUrl: string | null = null): string {
  return renderToStaticMarkup(
    <MemoryRouter>
      <Header discordUsername="yuzuki_nom1" avatarUrl={avatarUrl} onLogout={() => {}} />
    </MemoryRouter>,
  );
}

describe("Header", () => {
  test("discordUsernameとユーザーメニューのトリガーを描画する", () => {
    const html = renderHeader();
    expect(html).toContain("yuzuki_nom1");
    expect(html).toContain("Management Bot Dashboard");
  });

  test("タイトルはギルド選択画面(トップ)へのリンクになっている", () => {
    const html = renderHeader();
    expect(html).toMatch(/<a[^>]*href="\/"[^>]*>Management Bot Dashboard<\/a>/);
  });

  test("avatarUrlがあればアバター画像を描画する", () => {
    const html = renderHeader("https://cdn.discordapp.com/avatars/u1/abc.png");
    expect(html).toContain('src="https://cdn.discordapp.com/avatars/u1/abc.png"');
  });

  test("avatarUrlがnullなら画像を描画しない", () => {
    const html = renderHeader(null);
    expect(html).not.toContain("<img");
  });
});
