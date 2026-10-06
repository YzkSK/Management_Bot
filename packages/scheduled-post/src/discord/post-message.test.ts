import { describe, expect, test } from "bun:test";
import { buildPostEmbed } from "./post-message.js";

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
