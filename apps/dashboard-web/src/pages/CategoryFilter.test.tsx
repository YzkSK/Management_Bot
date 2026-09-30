import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { CategoryFilter } from "./CategoryFilter.js";

describe("CategoryFilter", () => {
  test("未選択なら「すべて」と表示し、選択中タグもクリアボタンも出さない", () => {
    const html = renderToStaticMarkup(<CategoryFilter selected={[]} onChange={() => {}} />);
    expect(html).toContain("<b>すべて</b>");
    expect(html).not.toContain("すべてクリア");
  });

  test("選択中のカテゴリは件数と、個別に解除できるタグで表示する", () => {
    const html = renderToStaticMarkup(<CategoryFilter selected={["member", "moderationCase"]} onChange={() => {}} />);
    expect(html).toContain("<b>2件選択中</b>");
    expect(html).toContain('aria-label="メンバーを解除"');
    expect(html).toContain('aria-label="モデレーションを解除"');
    expect(html).toContain("すべてクリア");
  });
});
