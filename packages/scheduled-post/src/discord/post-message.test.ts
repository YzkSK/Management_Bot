import { describe, expect, test } from "bun:test";
import { ComponentType } from "discord.js";
import { buildPostContainer } from "./post-message.js";

describe("buildPostContainer", () => {
  test("Section(表示名+アバター) → Separator → 本文のContainerになる", () => {
    const json = buildPostContainer("本文\n2行目", {
      authorName: "ゆず*き",
      authorAvatarUrl: "https://cdn.example/a.png",
    }).toJSON();

    expect(json.type).toBe(ComponentType.Container);
    const [section, separator, body] = json.components;
    expect(section?.type).toBe(ComponentType.Section);
    if (section?.type !== ComponentType.Section) throw new Error("expected section");
    expect(section.components[0]?.content).toBe("**ゆず\\*き**");
    expect(section.accessory.type).toBe(ComponentType.Thumbnail);
    expect(separator?.type).toBe(ComponentType.Separator);
    expect(body?.type).toBe(ComponentType.TextDisplay);
    if (body?.type !== ComponentType.TextDisplay) throw new Error("expected text display");
    expect(body.content).toBe("本文\n2行目");
  });
});
