import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { Header } from "./Header.js";

function renderHeader(avatarUrl: string | null = null): string {
  return renderToStaticMarkup(
    <MemoryRouter>
      <Header
        discordUsername="yuzuki_nom1"
        avatarUrl={avatarUrl}
        onLogout={() => {}}
        isSidebarOpen={false}
        onToggleSidebar={() => {}}
      />
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

  test("モバイル幅用のメニュー開閉ボタンを描画する(issue #267)", () => {
    const html = renderHeader();
    expect(html).toContain('aria-label="メニューを開閉"');
    expect(html).toContain('aria-controls="mobile-sidebar"');
  });

  test("メニュー開閉ボタンのaria-expandedはisSidebarOpenに追従する(issue #267)", () => {
    const closedHtml = renderToStaticMarkup(
      <MemoryRouter>
        <Header
          discordUsername="yuzuki_nom1"
          avatarUrl={null}
          onLogout={() => {}}
          isSidebarOpen={false}
          onToggleSidebar={() => {}}
        />
      </MemoryRouter>,
    );
    const openHtml = renderToStaticMarkup(
      <MemoryRouter>
        <Header
          discordUsername="yuzuki_nom1"
          avatarUrl={null}
          onLogout={() => {}}
          isSidebarOpen={true}
          onToggleSidebar={() => {}}
        />
      </MemoryRouter>,
    );
    expect(closedHtml).toContain('aria-expanded="false"');
    expect(openHtml).toContain('aria-expanded="true"');
  });
});
