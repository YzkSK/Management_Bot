import {
  ActionRowBuilder,
  ContainerBuilder,
  MessageFlags,
  RoleSelectMenuBuilder,
  SeparatorSpacingSize,
  TextDisplayBuilder,
  UserSelectMenuBuilder,
  type InteractionReplyOptions,
} from "discord.js";

/** 個別許可・拒否のSelectMenu用customId種別。ボタンのTEMP_VOICE_BUTTON_ACTIONSとは別に管理する。 */
export const TEMP_VOICE_SELECT_ACTIONS = ["permitMemberUser", "permitMemberRole", "denyMemberUser", "denyMemberRole"] as const;
export type TempVoiceSelectAction = (typeof TEMP_VOICE_SELECT_ACTIONS)[number];

export function buildTempVoiceSelectCustomId(action: TempVoiceSelectAction, channelId: string): string {
  return `temp-voice:${action}:${channelId}`;
}

export interface ParsedTempVoiceSelectCustomId {
  action: TempVoiceSelectAction;
  channelId: string;
}

export function parseTempVoiceSelectCustomId(customId: string): ParsedTempVoiceSelectCustomId | null {
  const [prefix, action, channelId] = customId.split(":");
  if (prefix !== "temp-voice" || !channelId) return null;
  if (!(TEMP_VOICE_SELECT_ACTIONS as readonly string[]).includes(action ?? "")) return null;
  return { action: action as TempVoiceSelectAction, channelId };
}

/**
 * 個別許可・個別拒否ボタン押下時にephemeralで返すセレクトUI(#409)。ユーザー/ロールどちらか
 * 一方を選んで送信する(RoleSelectMenu/UserSelectMenuはボタンと違い選択即座にinteractionが
 * 発火するため、送信ボタンは不要)。
 */
export function buildSelectPermissionMessage(
  mode: "permit" | "deny",
  channelId: string,
): InteractionReplyOptions {
  const isPermit = mode === "permit";
  const userAction: TempVoiceSelectAction = isPermit ? "permitMemberUser" : "denyMemberUser";
  const roleAction: TempVoiceSelectAction = isPermit ? "permitMemberRole" : "denyMemberRole";
  const title = isPermit ? "✅ 個別許可" : "⛔ 個別拒否";
  const description = isPermit
    ? "lock中でも入室できるユーザー・ロールを選びます。"
    : "常に入室できなくするユーザー・ロールを選びます。ロール選択時は対象ロール保持者のうちVC内にいるメンバー全員が切断されます。";

  const container = new ContainerBuilder()
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(`## ${title}\n${description}`))
    .addSeparatorComponents((separator) => separator.setSpacing(SeparatorSpacingSize.Small))
    .addActionRowComponents(
      new ActionRowBuilder<UserSelectMenuBuilder>().addComponents(
        new UserSelectMenuBuilder()
          .setCustomId(buildTempVoiceSelectCustomId(userAction, channelId))
          .setPlaceholder("ユーザーを選択")
          .setMinValues(1)
          .setMaxValues(1),
      ),
    )
    .addActionRowComponents(
      new ActionRowBuilder<RoleSelectMenuBuilder>().addComponents(
        new RoleSelectMenuBuilder()
          .setCustomId(buildTempVoiceSelectCustomId(roleAction, channelId))
          .setPlaceholder("ロールを選択")
          .setMinValues(1)
          .setMaxValues(1),
      ),
    );

  return { flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2, components: [container] };
}
