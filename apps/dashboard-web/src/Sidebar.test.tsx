import { describe, expect, test } from "bun:test";
import { FEATURE_METADATA } from "@management-bot/shared";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { Sidebar } from "./Sidebar.js";

describe("Sidebar", () => {
  test("FEATURE_METADATAの各エントリ名を描画する", () => {
    const html = renderToStaticMarkup(<Sidebar />);
    for (const feature of FEATURE_METADATA) {
      expect(html).toContain(feature.name);
    }
  });

  test("guildId未指定時はログ機能もリンクにならない", () => {
    const html = renderToStaticMarkup(<Sidebar />);
    expect(html).not.toContain("<a ");
  });

  test("guildId指定時はログ機能がログ一覧画面へのリンクになる", () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <Sidebar guildId="g1" />
      </MemoryRouter>,
    );
    expect(html).toContain('href="/guilds/g1/logs"');
  });
});
