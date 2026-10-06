import { SCHEDULED_POST_CONTENT_MAX, discordIdSchema } from "@management-bot/shared";
import {
  LabelBuilder,
  ModalBuilder,
  PermissionFlagsBits,
  RoleSelectMenuBuilder,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
  UserSelectMenuBuilder,
  type ModalSubmitInteraction,
} from "discord.js";
import { z } from "zod";
import type { ScheduledPostSettings } from "../application/index.js";
import {
  MENTION_ERROR_MESSAGES,
  validateMentionSelection,
  type MentionSelection,
} from "../domain/index.js";

const DATETIME_ID = "datetime";
const CONTENT_ID = "content";
const EVERYONE_ID = "mention-everyone";
const ROLES_ID = "mention-roles";
const USERS_ID = "mention-users";
const MENTION_MAX = 25;

const everyoneValuesSchema = z.array(z.enum(["everyone", "here"])).max(2);
const idsSchema = z.array(discordIdSchema).max(MENTION_MAX);

export const NO_MENTIONS_SELECTED: MentionSelection = { everyone: false, here: false, roleIds: [], userIds: [] };

export interface ModalValues {
  datetime?: string;
  content?: string;
  mentions: MentionSelection;
}

/** 日時・本文・メンション(全体/ロール/ユーザー)の5コンポーネントのモーダル。編集時はvaluesで保存値を初期表示する。 */
export function buildScheduleModal(
  customId: string,
  title: string,
  settings: Pick<ScheduledPostSettings, "allowEveryone" | "allowHere">,
  values: ModalValues,
): ModalBuilder {
  const datetime = new TextInputBuilder()
    .setCustomId(DATETIME_ID)
    .setPlaceholder("10/10 20:00 / 30分後 / 2時間後 / 3日後")
    .setStyle(TextInputStyle.Short)
    .setRequired(true);
  if (values.datetime !== undefined) datetime.setValue(values.datetime);
  const content = new TextInputBuilder()
    .setCustomId(CONTENT_ID)
    .setStyle(TextInputStyle.Paragraph)
    .setMinLength(1)
    .setMaxLength(SCHEDULED_POST_CONTENT_MAX)
    .setRequired(true);
  if (values.content !== undefined) content.setValue(values.content);

  const modal = new ModalBuilder()
    .setCustomId(customId)
    .setTitle(title)
    .addLabelComponents(
      new LabelBuilder().setLabel("日時(日本時間)").setTextInputComponent(datetime),
      new LabelBuilder().setLabel("投稿する本文(改行可)").setTextInputComponent(content),
    );

  const { mentions } = values;
  const everyoneOptions = [
    ...(settings.allowEveryone ? [{ label: "@everyone", value: "everyone", default: mentions.everyone }] : []),
    ...(settings.allowHere ? [{ label: "@here", value: "here", default: mentions.here }] : []),
  ];
  if (everyoneOptions.length > 0) {
    modal.addLabelComponents(
      new LabelBuilder().setLabel("全体メンション(任意)").setStringSelectMenuComponent(
        new StringSelectMenuBuilder()
          .setCustomId(EVERYONE_ID)
          .setPlaceholder("選択しない")
          .setMinValues(0)
          .setMaxValues(everyoneOptions.length)
          .setRequired(false)
          .addOptions(everyoneOptions),
      ),
    );
  }
  modal.addLabelComponents(
    new LabelBuilder().setLabel("ロールをメンション(任意)").setRoleSelectMenuComponent(
      new RoleSelectMenuBuilder()
        .setCustomId(ROLES_ID)
        .setPlaceholder("選択しない")
        .setMinValues(0)
        .setMaxValues(MENTION_MAX)
        .setRequired(false)
        .setDefaultRoles(mentions.roleIds.slice(0, MENTION_MAX)),
    ),
    new LabelBuilder().setLabel("ユーザーをメンション(任意)").setUserSelectMenuComponent(
      new UserSelectMenuBuilder()
        .setCustomId(USERS_ID)
        .setPlaceholder("選択しない")
        .setMinValues(0)
        .setMaxValues(MENTION_MAX)
        .setRequired(false)
        .setDefaultUsers(mentions.userIds.slice(0, MENTION_MAX)),
    ),
  );
  return modal;
}

export type ReadMentionsResult = { ok: true; mentions: MentionSelection } | { ok: false; message: string };

/**
 * 送信されたメンション選択をzodで検証し、設定・実行者の権限・ロールのmentionableに照らして確認する。
 * 全体メンション欄はモーダルに出した場合(設定で許可あり)のみ存在するため、欄が無ければ未選択として扱う。
 */
export function readMentions(
  interaction: ModalSubmitInteraction,
  settings: Pick<ScheduledPostSettings, "allowEveryone" | "allowHere">,
): ReadMentionsResult {
  const fields = interaction.fields;
  const invalid = { ok: false, message: "メンションの選択内容を処理できませんでした。もう一度お試しください。" } as const;

  const everyoneValues = fields.fields.has(EVERYONE_ID)
    ? everyoneValuesSchema.safeParse([...fields.getStringSelectValues(EVERYONE_ID)])
    : everyoneValuesSchema.safeParse([]);
  const roles = fields.fields.has(ROLES_ID) ? fields.getSelectedRoles(ROLES_ID) : null;
  const users = fields.fields.has(USERS_ID) ? fields.getSelectedUsers(USERS_ID) : null;
  const roleIds = idsSchema.safeParse(roles ? [...roles.keys()] : []);
  const userIds = idsSchema.safeParse(users ? [...users.keys()] : []);
  if (!everyoneValues.success || !roleIds.success || !userIds.success) return invalid;

  const selection: MentionSelection = {
    everyone: everyoneValues.data.includes("everyone"),
    here: everyoneValues.data.includes("here"),
    roleIds: roleIds.data,
    userIds: userIds.data,
  };
  const error = validateMentionSelection(selection, {
    allowEveryone: settings.allowEveryone,
    allowHere: settings.allowHere,
    canMentionEveryone: interaction.memberPermissions?.has(PermissionFlagsBits.MentionEveryone) ?? false,
    isRoleMentionable: (id) => roles?.get(id)?.mentionable ?? false,
  });
  return error ? { ok: false, message: MENTION_ERROR_MESSAGES[error] } : { ok: true, mentions: selection };
}
