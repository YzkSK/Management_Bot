import { describe, expect, test } from "bun:test";
import { FEATURE_METADATA } from "@management-bot/shared";
import { renderToStaticMarkup } from "react-dom/server";
import { Sidebar } from "./Sidebar.js";

describe("Sidebar", () => {
  test("FEATURE_METADATAの各エントリ名を描画する", () => {
    const html = renderToStaticMarkup(<Sidebar />);
    for (const feature of FEATURE_METADATA) {
      expect(html).toContain(feature.name);
    }
  });
});
