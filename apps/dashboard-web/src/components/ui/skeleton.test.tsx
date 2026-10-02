import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { Loading, Skeleton } from "./skeleton";

describe("Loading", () => {
  test("既定はスピナーと読み込み中を出す", () => {
    const html = renderToStaticMarkup(<Loading />);
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain("animate-spin");
    expect(html).toContain("読み込み中");
  });

  test("childrenがあればスケルトンを出し、読み込み中は視覚非表示にする", () => {
    const html = renderToStaticMarkup(
      <Loading>
        <Skeleton />
      </Loading>,
    );
    expect(html).toContain('<span class="sr-only">読み込み中</span>');
    expect(html).toContain('data-slot="skeleton"');
    expect(html).not.toContain("animate-spin");
  });
});
