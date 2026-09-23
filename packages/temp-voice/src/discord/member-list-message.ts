import { ButtonStyle, ContainerBuilder, MessageFlags, SeparatorSpacingSize, TextDisplayBuilder } from "discord.js";
import type { TempVoicePermissionOverrideRow, TempVoicePermissionTargetType } from "../application/index.js";

const REMOVE_MEMBER_ACTION = "removeMember";

/** メンバー管理一覧の解除ボタンcustomId: `temp-voice:removeMember:<channelId>:<targetType>:<targetId>`(#409)。 */
export function buildRemoveMemberCustomId(channelId: string, targetType: TempVoicePermissionTargetType, targetId: string): string {
  return `temp-voice:${REMOVE_MEMBER_ACTION}:${channelId}:${targetType}:${targetId}`;
}

export interface ParsedRemoveMemberCustomId {
  channelId: string;
  targetType: TempVoicePermissionTargetType;
  targetId: string;
}

export function parseRemoveMemberCustomId(customId: string): ParsedRemoveMemberCustomId | null {
  const [prefix, action, channelId, targetType, targetId] = customId.split(":");
  if (prefix !== "temp-voice" || action !== REMOVE_MEMBER_ACTION) return null;
  if (!channelId || !targetId) return null;
  if (targetType !== "user" && targetType !== "role") return null;
  return { channelId, targetType, targetId };
}

/**
 * メンバー管理一覧(#409)をephemeralで組み立てる。行ごとに対象種別バッジ・表示名・解除ボタンを出す。
 * targetNames: targetIdごとの表示名(呼び出し元がDiscord APIから解決済みのものを渡す)。解決できなければIDをそのまま表示する。
 */
export function buildMemberListMessage(
  channelId: string,
  overrides: readonly TempVoicePermissionOverrideRow[],
  targetNames: ReadonlyMap<string, string>,
): { flags: number; components: ContainerBuilder[] } {
  const container = new ContainerBuilder().addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      "## 📋 メンバー管理\n個別許可・拒否の登録一覧です。「解除」で@everyoneのロック/非表示設定に戻ります。",
    ),
  );

  if (overrides.length === 0) {
    container.addSeparatorComponents((separator) => separator.setSpacing(SeparatorSpacingSize.Small));
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent("登録はありません。"));
    return { flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2, components: [container] };
  }

  for (const override of overrides) {
    const stateLabel = override.state === "allow" ? "許可" : "拒否";
    const targetIcon = override.targetType === "user" ? "👤" : "🏷️";
    const targetLabel = targetNames.get(override.targetId) ?? override.targetId;

    container.addSeparatorComponents((separator) => separator.setSpacing(SeparatorSpacingSize.Small));
    container.addSectionComponents((section) =>
      section
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(`**${stateLabel}** ${targetIcon} ${targetLabel}`))
        .setButtonAccessory((button) =>
          button
            .setCustomId(buildRemoveMemberCustomId(channelId, override.targetType, override.targetId))
            .setLabel("解除")
            .setStyle(ButtonStyle.Secondary),
        ),
    );
  }

  return { flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2, components: [container] };
}

/**
 * 解除完了メッセージ(#409)。メンバー管理一覧(Components V2)を編集する応答のため、
 * Components V2メッセージは`content`を持てず`components`のみで構成する必要がある
 * (codexレビュー指摘: contentで送ると解除自体が失敗する)。
 */
export function buildRemoveMemberSuccessMessage(): { flags: number; components: ContainerBuilder[] } {
  const container = new ContainerBuilder().addTextDisplayComponents(
    new TextDisplayBuilder().setContent("解除しました。"),
  );
  return { flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2, components: [container] };
}
