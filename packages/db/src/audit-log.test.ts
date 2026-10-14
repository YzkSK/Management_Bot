import { describe, expect, test } from "bun:test";
import { redactSecrets } from "./audit-log.js";

describe("redactSecrets", () => {
  test("secret/token/password/webhookを含むキーの値を再帰的に伏せ字にする(大文字小文字を問わない)", () => {
    expect(
      redactSecrets({
        name: "x",
        webhookUrl: "https://example.com/hook",
        nested: { Password: "p", list: [{ apiToken: "t", keep: 1 }], clientSecret: "s" },
      }),
    ).toEqual({
      name: "x",
      webhookUrl: "***",
      nested: { Password: "***", list: [{ apiToken: "***", keep: 1 }], clientSecret: "***" },
    });
  });

  test("プリミティブ・null・配列はそのまま(配列要素は再帰)", () => {
    expect(redactSecrets(null)).toBeNull();
    expect(redactSecrets("token")).toBe("token");
    expect(redactSecrets([1, { secret: "a" }])).toEqual([1, { secret: "***" }]);
  });
});
