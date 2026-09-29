import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { Loading } from "./skeleton";

describe("Loading", () => {
  test("aria-busyと視覚非表示の読み込み中を持ち、既定で行のスケルトンを出す", () => {
    const html = renderToStaticMarkup(<Loading rows={2} />);
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('<span class="sr-only">読み込み中</span>');
    expect(html.match(/data-slot="skeleton"/g)).toHaveLength(2);
  });
});
