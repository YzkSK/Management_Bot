import { describe, expect, it } from "bun:test";
import { diffPermissions } from "./discord-permission-labels.js";

describe("diffPermissions", () => {
  it("0→1056(manageGuild+viewChannel)を追加権限として返す", () => {
    const result = diffPermissions("0", "1056");
    expect(result?.added).toEqual(["サーバーの管理", "チャンネルを見る"]);
    expect(result?.removed).toEqual([]);
  });

  it("剥奪された権限をremovedとして返す", () => {
    const result = diffPermissions("1056", "1024");
    expect(result?.added).toEqual([]);
    expect(result?.removed).toEqual(["サーバーの管理"]);
  });

  it("差分がなければ両方空配列", () => {
    const result = diffPermissions("8", "8");
    expect(result?.added).toEqual([]);
    expect(result?.removed).toEqual([]);
  });

  it("追加と削除が同時に起きるケースを両方返す", () => {
    // 8(administrator)を外し、32(manageGuild)を付与
    const result = diffPermissions("8", "32");
    expect(result?.added).toEqual(["サーバーの管理"]);
    expect(result?.removed).toEqual(["管理者"]);
  });

  it("bit49(sendPolls)・bit52(低速モードを回避)を含む大きな値も検出する", () => {
    const sendPolls = 1n << 49n;
    const bypassSlowmode = 1n << 52n;
    const result = diffPermissions("0", (sendPolls | bypassSlowmode).toString());
    expect(result?.added).toEqual(["投票を作成", "低速モードを回避"]);
  });

  it("bit48(ボイスチャンネルステータスの設定)・bit51(メッセージをピン留め)を検出する", () => {
    const setVoiceChannelStatus = 1n << 48n;
    const pinMessages = 1n << 51n;
    const result = diffPermissions("0", (setVoiceChannelStatus | pinMessages).toString());
    expect(result?.added).toEqual(["ボイスチャンネルステータスの設定", "メッセージをピン留め"]);
  });

  it("未知のビットのみの変更を「変更なし」にせず不明な権限として返す", () => {
    const unknownBit = 1n << 60n;
    const result = diffPermissions("0", unknownBit.toString());
    expect(result?.added).toEqual([`不明な権限(0b${unknownBit.toString(2)})`]);
  });

  it("数値として解釈できない値はnullを返す(呼び出し側でのフォールバック用)", () => {
    expect(diffPermissions("unknown", "1024")).toBeNull();
    expect(diffPermissions("1024", "-1")).toBeNull();
  });
});
