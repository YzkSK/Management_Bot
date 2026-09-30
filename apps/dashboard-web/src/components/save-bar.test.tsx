import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { SaveBar } from "./save-bar.js";

const noop = () => {};

describe("SaveBar", () => {
  test("未保存の変更がなければ何も描画しない", () => {
    expect(renderToStaticMarkup(<SaveBar dirty={false} saving={false} onSave={noop} onDiscard={noop} />)).toBe("");
  });

  test("未保存の変更があれば保存・破棄ボタンを出す", () => {
    const html = renderToStaticMarkup(<SaveBar dirty saving={false} onSave={noop} onDiscard={noop} />);
    expect(html).toContain("保存されていない変更があります");
    expect(html).toContain("変更を破棄");
    expect(html).toContain(">保存<");
  });

  test("保存中はボタンを無効化し保存中と表示する", () => {
    const html = renderToStaticMarkup(<SaveBar dirty saving onSave={noop} onDiscard={noop} />);
    expect(html).toContain("保存中...");
    expect(html.match(/disabled=""/g)?.length).toBe(2);
  });
});
