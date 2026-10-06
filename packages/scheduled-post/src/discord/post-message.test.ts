import { describe, expect, test } from "bun:test";
import { buildPostEmbed, buildPostMessage } from "./post-message.js";

describe("buildPostMessage", () => {
  const view = { authorName: "a", authorAvatarUrl: "" };

  test("メンションがあればcontentに入れ、allowedMentionsを明示する", () => {
    const message = buildPostMessage("本文", view, {
      content: "@everyone <@&1>",
      allowedMentions: { parse: ["everyone"], roles: ["1"], users: [] },
    });
    expect(message.content).toBe("@everyone <@&1>");
    expect(message.embeds[0]?.toJSON().description).toBe("本文");
    expect(message.allowedMentions).toEqual({ parse: ["everyone"], roles: ["1"], users: [] });
  });

  test("メンションが無ければcontentを付けず、何も通知しない", () => {
    const message = buildPostMessage("本文", view, { content: undefined, allowedMentions: { parse: [], roles: [], users: [] } });
    expect("content" in message).toBe(false);
    expect(message.allowedMentions).toEqual({ parse: [], roles: [], users: [] });
  });
});

describe("buildPostEmbed", () => {
  test("Embedのauthorに表示名とアバター、descriptionに本文を入れる", () => {
    const embed = buildPostEmbed("本文\n2行目", {
      authorName: "ゆずき",
      authorAvatarUrl: "https://cdn.example/a.png",
    }).toJSON();

    expect(embed.author).toEqual({ name: "ゆずき", icon_url: "https://cdn.example/a.png" });
    expect(embed.description).toBe("本文\n2行目");
  });

  test("アバターURLが無ければiconを付けない", () => {
    expect(buildPostEmbed("x", { authorName: "a", authorAvatarUrl: "" }).toJSON().author).toEqual({ name: "a" });
  });
});
