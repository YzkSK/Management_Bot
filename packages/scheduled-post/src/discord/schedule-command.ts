import type { FeatureModuleContext } from "@management-bot/core";
import { SCHEDULED_POST_CONTENT_MAX } from "@management-bot/shared";
import {
  ActionRowBuilder,
  ApplicationCommandOptionType,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  MessageFlags,
  PermissionFlagsBits,
  StringSelectMenuBuilder,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type Client,
  type ModalSubmitInteraction,
  type RESTPostAPIChatInputApplicationCommandsJSONBody,
  type StringSelectMenuInteraction,
} from "discord.js";
import {
  getScheduledPost,
  getSettings,
  listMyPendingPosts,
  mentionSelectionOf,
  type ScheduledPostRow,
} from "../application/index.js";
import {
  LIMIT_ERROR_MESSAGES,
  MIN_LEAD_MS,
  formatScheduleInput,
  formatScheduledAt,
  formatScheduledLabel,
  resolveScheduledAt,
} from "../domain/index.js";
import {
  CREATE_MODAL_CUSTOM_ID,
  SELECT_CUSTOM_ID,
  cancelButtonCustomId,
  editButtonCustomId,
  editModalCustomId,
  isScheduledPostCustomId,
  parseCancelButtonCustomId,
  parseEditButtonCustomId,
  parseEditModalCustomId,
  parseSelectedPostId,
} from "./custom-ids.js";
import type { PublishScheduledPostEvent } from "./events.js";
import { NO_MENTIONS_SELECTED, buildScheduleModal, canMentionEveryoneIn, readMentions } from "./mention-modal.js";
import { cancelOwnPostAction, createPostAction, editPostAction } from "./schedule-actions.js";

export const SCHEDULE_COMMAND: RESTPostAPIChatInputApplicationCommandsJSONBody = {
  name: "schedule",
  description: "メッセージの予約投稿",
  dm_permission: false,
  options: [
    {
      type: ApplicationCommandOptionType.Subcommand,
      name: "create",
      description: "このチャンネルに予約投稿する(日時と本文は次の画面で入力)",
    },
    {
      type: ApplicationCommandOptionType.Subcommand,
      name: "list",
      description: "自分の投稿待ちの予約を表示・編集・取り消し(本人にだけ表示)",
    },
  ],
};

const NOT_PENDING_MESSAGE = "この予約はすでに投稿処理が始まったか、取り消されています。";
const CONTENT_INVALID_MESSAGE = `本文は1〜${SCHEDULED_POST_CONTENT_MAX}文字で入力してください。`;
const NO_MENTIONS = { parse: [] } as const;

export interface ScheduleCommandDeps {
  ctx: FeatureModuleContext;
  publish: PublishScheduledPostEvent;
}

type CreateCheckInteraction = ChatInputCommandInteraction<"cached" | "raw"> | ModalSubmitInteraction;

function memberRoleIds(interaction: CreateCheckInteraction): string[] {
  const member = interaction.member;
  if (!member) return [];
  return Array.isArray(member.roles) ? member.roles : [...member.roles.cache.keys()];
}

function channelNameOf(interaction: { channel: CreateCheckInteraction["channel"] }): string | undefined {
  const channel = interaction.channel;
  return channel && !channel.isDMBased() ? channel.name : undefined;
}

/**
 * 予約を登録してよいか確認する。投稿先が対象のチャンネル種別・実行者に送信権限・
 * 「使えるロール」を満たす、を順に確認し、満たさなければ利用者向けのエラー文言を返す。
 */
async function checkCanCreate(deps: ScheduleCommandDeps, interaction: CreateCheckInteraction): Promise<string | null> {
  if (!interaction.guildId) return "サーバー内でのみ使えます。";

  const channel = interaction.channel;
  if (!channel) return "チャンネル情報を取得できませんでした。";
  const isThread =
    channel.type === ChannelType.PublicThread ||
    channel.type === ChannelType.PrivateThread ||
    channel.type === ChannelType.AnnouncementThread;
  // フォーラムチャンネル自体ではコマンドを実行できず、投稿(スレッド)内ならisThreadとして扱う。
  if (!isThread && channel.type !== ChannelType.GuildText && channel.type !== ChannelType.GuildAnnouncement) {
    return "このチャンネルには予約投稿できません(テキストチャンネル・アナウンスチャンネル・スレッドのみ)。";
  }

  const sendPermission = isThread ? PermissionFlagsBits.SendMessagesInThreads : PermissionFlagsBits.SendMessages;
  if (!interaction.memberPermissions?.has(sendPermission)) {
    return "このチャンネルにメッセージを送信する権限がないため、予約できません。";
  }

  const { allowedRoleIds } = await getSettings(deps.ctx.db, interaction.guildId);
  if (allowedRoleIds.length > 0) {
    const roleIds = memberRoleIds(interaction);
    if (!allowedRoleIds.some((roleId) => roleIds.includes(roleId))) {
      return "予約投稿を使えるロールを持っていません。";
    }
  }
  return null;
}

function preview(text: string, max: number): string {
  const singleLine = text.replace(/\s+/g, " ").trim();
  return singleLine.length > max ? `${singleLine.slice(0, max - 1)}…` : singleLine;
}

/** `/schedule list`の表示。selectedIdがあれば、その予約の詳細と編集・取り消しボタンを付ける。 */
function buildListReply(posts: readonly ScheduledPostRow[], now: Date, selectedId?: string, notice?: string) {
  if (posts.length === 0) {
    return { content: [notice, "投稿待ちの予約はありません。"].filter(Boolean).join("\n"), components: [] };
  }
  const selected = posts.find((post) => post.id === selectedId);
  const lines = [notice, `投稿待ちの予約: ${posts.length}件(メニューから選ぶと編集・取り消しができます)`];
  if (selected) {
    lines.push(
      "",
      `投稿先: <#${selected.channelId}>`,
      `日時: ${formatScheduledAt(selected.scheduledAt, now)}`,
      "本文:",
      "```",
      selected.content.slice(0, 1200).replaceAll("```", "'''"),
      "```",
    );
  }
  const select = new StringSelectMenuBuilder()
    .setCustomId(SELECT_CUSTOM_ID)
    .setPlaceholder("予約を選択")
    .addOptions(
      posts.map((post) => ({
        label: `${formatScheduledLabel(post.scheduledAt, now)} ${preview(post.content, 60)}`.slice(0, 100),
        value: post.id,
        default: post.id === selected?.id,
      })),
    );
  const components: ActionRowBuilder<StringSelectMenuBuilder | ButtonBuilder>[] = [
    new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select),
  ];
  if (selected) {
    components.push(
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(editButtonCustomId(selected.id)).setLabel("編集").setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(cancelButtonCustomId(selected.id)).setLabel("取り消し").setStyle(ButtonStyle.Danger),
      ),
    );
  }
  return { content: lines.filter((line) => line !== undefined).join("\n"), components };
}

async function ephemeral(
  interaction: { reply: (options: { content: string; flags: MessageFlags.Ephemeral }) => Promise<unknown> },
  content: string,
): Promise<void> {
  await interaction.reply({ content, flags: MessageFlags.Ephemeral });
}

async function handleCreateCommand(
  deps: ScheduleCommandDeps,
  interaction: ChatInputCommandInteraction<"cached" | "raw">,
): Promise<void> {
  const error = await checkCanCreate(deps, interaction);
  if (error) return ephemeral(interaction, error);

  const settings = await getSettings(deps.ctx.db, interaction.guildId);
  await interaction.showModal(
    buildScheduleModal(CREATE_MODAL_CUSTOM_ID, "予約投稿", settings, { mentions: NO_MENTIONS_SELECTED }),
  );
}

async function handleListCommand(
  deps: ScheduleCommandDeps,
  interaction: ChatInputCommandInteraction<"cached" | "raw">,
): Promise<void> {
  const posts = await listMyPendingPosts(deps.ctx.db, interaction.guildId, interaction.user.id);
  await interaction.reply({
    ...buildListReply(posts, new Date()),
    flags: MessageFlags.Ephemeral,
    allowedMentions: NO_MENTIONS,
  });
}

async function handleCreateModal(deps: ScheduleCommandDeps, interaction: ModalSubmitInteraction): Promise<void> {
  if (!interaction.guildId || !interaction.channelId) {
    return ephemeral(interaction, "入力を処理できませんでした。もう一度お試しください。");
  }

  // モーダルを開いてから時間が経っているため、権限・機能有効を送信時点で再確認する。
  const error = await checkCanCreate(deps, interaction);
  if (error) return ephemeral(interaction, error);

  const now = new Date();
  const resolved = resolveScheduledAt(interaction.fields.getTextInputValue("datetime"), now);
  if (!resolved.ok) return ephemeral(interaction, resolved.message);
  const scheduledAt = resolved.date;

  const mentionResult = readMentions(
    interaction,
    await getSettings(deps.ctx.db, interaction.guildId),
    await canMentionEveryoneIn(interaction, interaction.channelId),
  );
  if (!mentionResult.ok) return ephemeral(interaction, mentionResult.message);

  const result = await createPostAction(
    { db: deps.ctx.db, publish: deps.publish },
    {
      guildId: interaction.guildId,
      channelId: interaction.channelId,
      channelName: channelNameOf(interaction),
      authorId: interaction.user.id,
      authorName: interaction.user.displayName,
      content: interaction.fields.getTextInputValue("content"),
      scheduledAt,
      mentions: mentionResult.mentions,
    },
  );
  if (!result.ok) {
    return ephemeral(interaction, result.error === "invalid_content" ? CONTENT_INVALID_MESSAGE : LIMIT_ERROR_MESSAGES[result.error]);
  }
  await ephemeral(
    interaction,
    `✅ ${formatScheduledAt(result.post.scheduledAt, new Date())}に <#${interaction.channelId}> へ予約しました`,
  );
}

async function handleSelect(deps: ScheduleCommandDeps, interaction: StringSelectMenuInteraction): Promise<void> {
  if (!interaction.guildId) return;
  const postId = parseSelectedPostId(interaction.values);
  const posts = await listMyPendingPosts(deps.ctx.db, interaction.guildId, interaction.user.id);
  const exists = postId !== null && posts.some((post) => post.id === postId);
  await interaction.update({
    ...buildListReply(posts, new Date(), exists ? postId : undefined, exists ? undefined : NOT_PENDING_MESSAGE),
    allowedMentions: NO_MENTIONS,
  });
}

async function handleEditButton(deps: ScheduleCommandDeps, interaction: ButtonInteraction): Promise<void> {
  const postId = parseEditButtonCustomId(interaction.customId);
  if (!postId) return;
  const post = await getScheduledPost(deps.ctx.db, postId);
  if (!post || post.authorId !== interaction.user.id || post.status !== "pending") {
    return ephemeral(interaction, NOT_PENDING_MESSAGE);
  }
  if (post.scheduledAt.getTime() <= Date.now() + MIN_LEAD_MS) {
    return ephemeral(interaction, "投稿予定時刻の1分前を過ぎたため、編集できません。");
  }

  const settings = await getSettings(deps.ctx.db, post.guildId);
  await interaction.showModal(
    buildScheduleModal(editModalCustomId(post.id), "予約の編集", settings, {
      datetime: formatScheduleInput(post.scheduledAt),
      content: post.content,
      mentions: mentionSelectionOf(post),
    }),
  );
}

async function handleEditModal(deps: ScheduleCommandDeps, interaction: ModalSubmitInteraction): Promise<void> {
  const postId = parseEditModalCustomId(interaction.customId);
  if (!postId) return;

  const resolved = resolveScheduledAt(interaction.fields.getTextInputValue("datetime"), new Date());
  if (!resolved.ok) return ephemeral(interaction, resolved.message);

  const existing = await getScheduledPost(deps.ctx.db, postId);
  if (!existing || existing.authorId !== interaction.user.id || existing.status !== "pending") {
    return ephemeral(interaction, NOT_PENDING_MESSAGE);
  }
  const mentionResult = readMentions(
    interaction,
    await getSettings(deps.ctx.db, existing.guildId),
    await canMentionEveryoneIn(interaction, existing.channelId),
  );
  if (!mentionResult.ok) return ephemeral(interaction, mentionResult.message);

  const result = await editPostAction(
    { db: deps.ctx.db, publish: deps.publish },
    {
      id: postId,
      authorId: interaction.user.id,
      authorName: interaction.user.displayName,
      content: interaction.fields.getTextInputValue("content"),
      scheduledAt: resolved.date,
      mentions: mentionResult.mentions,
    },
  );
  if (!result.ok) {
    const message =
      result.error === "invalid_content"
        ? CONTENT_INVALID_MESSAGE
        : result.error === "too_late"
          ? "投稿予定時刻の1分前を過ぎたため、編集できません。"
          : NOT_PENDING_MESSAGE;
    return ephemeral(interaction, message);
  }
  await ephemeral(interaction, `予約を更新しました: ${formatScheduledAt(result.after.scheduledAt, new Date())}`);
}

async function handleCancelButton(deps: ScheduleCommandDeps, interaction: ButtonInteraction): Promise<void> {
  const postId = parseCancelButtonCustomId(interaction.customId);
  if (!postId || !interaction.guildId) return;
  const row = await cancelOwnPostAction(
    { db: deps.ctx.db, publish: deps.publish },
    {
      id: postId,
      guildId: interaction.guildId,
      authorId: interaction.user.id,
      authorName: interaction.user.displayName,
    },
  );
  const posts = await listMyPendingPosts(deps.ctx.db, interaction.guildId, interaction.user.id);
  await interaction.update({
    ...buildListReply(posts, new Date(), undefined, row ? "予約を取り消しました。" : NOT_PENDING_MESSAGE),
    allowedMentions: NO_MENTIONS,
  });
}

/**
 * `/schedule`をグローバルコマンドとして登録し、コマンド・モーダル・セレクト・ボタンを処理する。
 * commands.createは同名コマンドを上書きするため再起動で重複せず、他機能のコマンドも消さない。
 */
export function registerScheduleCommand(deps: ScheduleCommandDeps): void {
  const { ctx } = deps;
  const register = (client: Client<true>) => {
    void client.application.commands.create(SCHEDULE_COMMAND).catch((error: unknown) => {
      console.error("scheduled-post: failed to register /schedule command", error);
    });
  };
  if (ctx.client.isReady()) register(ctx.client);
  else ctx.client.once("ready", register);

  ctx.client.on("interactionCreate", (interaction) => {
    const handle = (task: Promise<void>): void => {
      task.catch((error: unknown) => {
        console.error("scheduled-post: failed to handle interaction", error);
        if (interaction.isRepliable() && !interaction.replied && !interaction.deferred) {
          interaction
            .reply({ content: "処理に失敗しました。時間をおいて再度お試しください。", flags: MessageFlags.Ephemeral })
            .catch(() => undefined);
        }
      });
    };

    if (interaction.isChatInputCommand()) {
      if (interaction.commandName !== SCHEDULE_COMMAND.name || !interaction.inGuild()) return;
      const subcommand = interaction.options.getSubcommand();
      if (subcommand === "create") handle(handleCreateCommand(deps, interaction));
      else if (subcommand === "list") handle(handleListCommand(deps, interaction));
      return;
    }
    if (interaction.isModalSubmit() && isScheduledPostCustomId(interaction.customId)) {
      if (interaction.customId === CREATE_MODAL_CUSTOM_ID) handle(handleCreateModal(deps, interaction));
      else if (parseEditModalCustomId(interaction.customId)) handle(handleEditModal(deps, interaction));
      return;
    }
    if (interaction.isStringSelectMenu() && interaction.customId === SELECT_CUSTOM_ID) {
      handle(handleSelect(deps, interaction));
      return;
    }
    if (interaction.isButton() && isScheduledPostCustomId(interaction.customId)) {
      if (parseEditButtonCustomId(interaction.customId)) handle(handleEditButton(deps, interaction));
      else if (parseCancelButtonCustomId(interaction.customId)) handle(handleCancelButton(deps, interaction));
    }
  });
}
