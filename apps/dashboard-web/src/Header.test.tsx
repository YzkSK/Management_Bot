import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { Header } from "./Header.js";

describe("Header", () => {
  test("discordUserIdを描画する", () => {
    const html = renderToStaticMarkup(<Header discordUserId="123456789" />);
    expect(html).toContain("123456789");
    expect(html).toContain("Management Bot Dashboard");
  });
});
