import { ActionRowBuilder, ModalBuilder, TextInputBuilder, TextInputStyle } from "discord.js";
import { buildTempVoiceCustomId, type TempVoiceButtonAction } from "./control-panel-message.js";

/** rename/userLimit/bitrateモーダルを組み立てる(#408)。currentValueは入力欄の初期値。 */
export function buildTempVoiceModal(
  action: Extract<TempVoiceButtonAction, "rename" | "userLimit" | "bitrate">,
  channelId: string,
  currentValue: string,
): ModalBuilder {
  const { title, label, maxLength } = MODAL_FIELD_BY_ACTION[action];
  const input = new TextInputBuilder()
    .setCustomId("value")
    .setLabel(label)
    .setStyle(TextInputStyle.Short)
    .setValue(currentValue)
    .setRequired(true);
  if (maxLength) input.setMaxLength(maxLength);

  return new ModalBuilder()
    .setCustomId(buildTempVoiceCustomId(action, channelId))
    .setTitle(title)
    .addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(input));
}

const MODAL_FIELD_BY_ACTION: Record<
  Extract<TempVoiceButtonAction, "rename" | "userLimit" | "bitrate">,
  { title: string; label: string; maxLength?: number }
> = {
  rename: { title: "VCの名前を変更", label: "チャンネル名(1〜100文字)", maxLength: 100 },
  userLimit: { title: "人数制限を変更", label: "人数(0〜99・0で無制限)" },
  bitrate: { title: "音質(ビットレート)を変更", label: "kbps" },
};
