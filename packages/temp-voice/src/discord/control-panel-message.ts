import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  PermissionFlagsBits,
  SeparatorSpacingSize,
  TextDisplayBuilder,
  type VoiceBasedChannel,
} from "discord.js";

export const TEMP_VOICE_BUTTON_ACTIONS = [
  "rename",
  "userLimit",
  "bitrate",
  "toggleLock",
  "toggleHide",
  "permitMember",
  "denyMember",
  "manageMembers",
] as const;
export type TempVoiceButtonAction = (typeof TEMP_VOICE_BUTTON_ACTIONS)[number];

/** customIdは`temp-voice:<action>:<channelId>`形式(#408)。 */
export function buildTempVoiceCustomId(action: TempVoiceButtonAction, channelId: string): string {
  return `temp-voice:${action}:${channelId}`;
}

export interface ParsedTempVoiceCustomId {
  action: TempVoiceButtonAction;
  channelId: string;
}

/** customIdをパースする。想定外のcustomId(他機能のボタン等)はnullを返す。 */
export function parseTempVoiceCustomId(customId: string): ParsedTempVoiceCustomId | null {
  const [prefix, action, channelId] = customId.split(":");
  if (prefix !== "temp-voice" || !channelId) return null;
  if (!(TEMP_VOICE_BUTTON_ACTIONS as readonly string[]).includes(action ?? "")) return null;
  return { action: action as TempVoiceButtonAction, channelId };
}

export interface TempVoiceState {
  userLimit: number;
  bitrate: number;
  isLocked: boolean;
  isHidden: boolean;
}

/**
 * VCの実際のpermissionOverwrite/userLimit/bitrateから現在状態を読み取る。
 * トグルボタンのラベル・処理はbot側のメモリ・DBではなくこの実測値に従う設計
 * (issue #408: メッセージ自体をeditして見た目を保持するが、判定はDiscord側の実状態を信頼する)。
 */
export function readTempVoiceState(voiceChannel: VoiceBasedChannel): TempVoiceState {
  const everyoneId = voiceChannel.guild.roles.everyone.id;
  const overwrite = voiceChannel.permissionOverwrites.cache.get(everyoneId);
  return {
    userLimit: voiceChannel.userLimit,
    bitrate: voiceChannel.bitrate,
    isLocked: overwrite?.deny.has(PermissionFlagsBits.Connect) ?? false,
    isHidden: overwrite?.deny.has(PermissionFlagsBits.ViewChannel) ?? false,
  };
}

/**
 * 制御パネルメッセージのContainer(Components V2)を、現在状態に応じたボタンラベルで組み立てる(#408)。
 * 呼び出し側(send用/edit用でflagsの型が微妙に異なる)が`{ flags: MessageFlags.IsComponentsV2, components: [container] }`
 * の形で包んで使う。
 */
export function buildControlPanelContainer(channelId: string, state: TempVoiceState): ContainerBuilder {
  const container = new ContainerBuilder()
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent("## 🔊 一時VC — 制御パネル\nこのVCのオーナーだけが下のボタンを操作できます。"),
    )
    .addSeparatorComponents((separator) => separator.setSpacing(SeparatorSpacingSize.Small))
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        [
          `人数制限: ${state.userLimit === 0 ? "無制限" : `${state.userLimit}人`}`,
          `音質: ${Math.round(state.bitrate / 1000)} kbps`,
          `状態: ${state.isLocked ? "🔒 ロック中" : "🔓 未ロック"} / ${state.isHidden ? "非表示中" : "表示中"}`,
        ].join("\n"),
      ),
    )
    .addActionRowComponents(
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(buildTempVoiceCustomId("rename", channelId))
          .setLabel("名前変更")
          .setEmoji("✏️")
          .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId(buildTempVoiceCustomId("userLimit", channelId))
          .setLabel("人数制限")
          .setEmoji("👥")
          .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId(buildTempVoiceCustomId("bitrate", channelId))
          .setLabel("音質")
          .setEmoji("🎚️")
          .setStyle(ButtonStyle.Secondary),
      ),
    )
    .addActionRowComponents(
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        state.isLocked
          ? new ButtonBuilder()
              .setCustomId(buildTempVoiceCustomId("toggleLock", channelId))
              .setLabel("ロック解除")
              .setEmoji("🔒")
              .setStyle(ButtonStyle.Success)
          : new ButtonBuilder()
              .setCustomId(buildTempVoiceCustomId("toggleLock", channelId))
              .setLabel("ロック")
              .setEmoji("🔓")
              .setStyle(ButtonStyle.Secondary),
        state.isHidden
          ? new ButtonBuilder()
              .setCustomId(buildTempVoiceCustomId("toggleHide", channelId))
              .setLabel("表示する")
              .setEmoji("👁️‍🗨️")
              .setStyle(ButtonStyle.Success)
          : new ButtonBuilder()
              .setCustomId(buildTempVoiceCustomId("toggleHide", channelId))
              .setLabel("非表示にする")
              .setEmoji("👁️")
              .setStyle(ButtonStyle.Secondary),
      ),
    )
    .addActionRowComponents(
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(buildTempVoiceCustomId("permitMember", channelId))
          .setLabel("個別許可")
          .setEmoji("✅")
          .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
          .setCustomId(buildTempVoiceCustomId("denyMember", channelId))
          .setLabel("個別拒否")
          .setEmoji("⛔")
          .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
          .setCustomId(buildTempVoiceCustomId("manageMembers", channelId))
          .setLabel("メンバー管理")
          .setEmoji("📋")
          .setStyle(ButtonStyle.Secondary),
      ),
    );

  return container;
}
