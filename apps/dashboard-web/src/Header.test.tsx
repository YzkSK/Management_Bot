import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { Header } from "./Header.js";

describe("Header", () => {
  test("discordUsernameとログアウトボタンを描画する", () => {
    const html = renderToStaticMarkup(<Header discordUsername="yuzuki_nom1" onLogout={() => {}} />);
    expect(html).toContain("yuzuki_nom1");
    expect(html).toContain("Management Bot Dashboard");
    expect(html).toContain("ログアウト");
  });
});
