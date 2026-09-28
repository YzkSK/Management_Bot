import {
  ActionRowBuilder,
  ContainerBuilder,
  MessageFlags,
  SeparatorSpacingSize,
  StringSelectMenuBuilder,
  TextDisplayBuilder,
  type GuildMember,
  type InteractionReplyOptions,
} from "discord.js";

export const TRANSFER_OWNER_SELECT_ACTION = "transferOwnerUser";
/** StringSelectMenu 1つあたりの選択肢上限(Discordの仕様)。 */
const OPTIONS_PER_MENU = 25;
/** 1メッセージに置けるActionRowの上限(Discordの仕様)。userLimitの最大99人まで25*5=125人でカバーする。 */
const MAX_MENUS = 5;

/** customIdにメニュー番号(0始まり)を含める。複数メニューに分割した際、送信元メニューを識別するため(#410)。 */
export function buildTransferOwnerSelectCustomId(channelId: string, menuIndex: number): string {
  return `temp-voice:${TRANSFER_OWNER_SELECT_ACTION}:${channelId}:${menuIndex}`;
}

export interface ParsedTransferOwnerSelectCustomId {
  channelId: string;
}

export function parseTransferOwnerSelectCustomId(customId: string): ParsedTransferOwnerSelectCustomId | null {
  const [prefix, action, channelId] = customId.split(":");
  if (prefix !== "temp-voice" || action !== TRANSFER_OWNER_SELECT_ACTION || !channelId) return null;
  return { channelId };
}

/**
 * オーナー移譲ボタン押下時にephemeralで返すセレクトUI(#410)。
 * DiscordのUserSelectMenuはサーバー内全メンバーから選べてしまい「VC内の現メンバーのみ」を
 * UI自体で強制できないため、StringSelectMenuでVC内メンバー(オーナー自身を除く)のみを
 * 選択肢として動的に生成する。
 * 1つのStringSelectMenuは25選択肢までのため、26人以上いる場合は複数メニューに分割する
 * (codexレビュー指摘: 25人超過時に26人目以降が選択できなくなっていた)。userLimit上限99人でも
 * 5メニュー(125人分)で足りる。それでも超過する場合(userLimit無制限設定時)は先頭125人のみ表示する。
 */
export function buildTransferOwnerMessage(
  channelId: string,
  membersInChannel: readonly GuildMember[],
): InteractionReplyOptions {
  if (membersInChannel.length === 0) {
    const container = new ContainerBuilder().addTextDisplayComponents(
      new TextDisplayBuilder().setContent("## 👑 オーナー移譲\n移譲先にできるメンバーがVC内にいません。"),
    );
    return { flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2, components: [container] };
  }

  const truncated = membersInChannel.slice(0, OPTIONS_PER_MENU * MAX_MENUS);
  const isTruncated = membersInChannel.length > truncated.length;
  const description = isTruncated
    ? `移譲先のメンバーをVC内から選びます。人数制限無しのVC等でメンバーが多すぎるため、先頭${truncated.length}人のみ表示しています。`
    : "移譲先のメンバーをVC内から選びます。";
  const container = new ContainerBuilder()
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(`## 👑 オーナー移譲\n${description}`))
    .addSeparatorComponents((separator) => separator.setSpacing(SeparatorSpacingSize.Small));

  for (let menuIndex = 0; menuIndex * OPTIONS_PER_MENU < truncated.length; menuIndex++) {
    const pageMembers = truncated.slice(menuIndex * OPTIONS_PER_MENU, (menuIndex + 1) * OPTIONS_PER_MENU);
    container.addActionRowComponents(
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(buildTransferOwnerSelectCustomId(channelId, menuIndex))
          .setPlaceholder(truncated.length > OPTIONS_PER_MENU ? `移譲先のメンバーを選択(${menuIndex + 1}/${Math.ceil(truncated.length / OPTIONS_PER_MENU)})` : "移譲先のメンバーを選択")
          .setMinValues(1)
          .setMaxValues(1)
          .addOptions(pageMembers.map((member) => ({ label: member.displayName, value: member.id }))),
      ),
    );
  }

  return { flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2, components: [container] };
}
