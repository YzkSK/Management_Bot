import {
  ChannelType,
  DiscordAPIError,
  PermissionFlagsBits,
  type Client,
  type Guild,
  type GuildBasedChannel,
  type GuildMember,
} from "discord.js";
import type { PostChannelKind, PostFacts } from "../domain/index.js";
import { buildPostMessage } from "./post-message.js";
import type { PostInspection, SchedulerGateway } from "./scheduler.js";

/** Unknown Channel / Unknown Member(RESTJSONErrorCodes)。 */
const UNKNOWN_CHANNEL = 10003;
const UNKNOWN_MEMBER = 10007;

/** 「見つからない」を表すDiscord APIエラーのみnullに落とし、それ以外(通信障害等)は呼び出し元へ投げる。 */
async function nullIfUnknown<T>(task: Promise<T>, unknownCode: number): Promise<T | null> {
  try {
    return await task;
  } catch (error) {
    if (error instanceof DiscordAPIError && error.code === unknownCode) return null;
    throw error;
  }
}

function channelKindOf(channel: GuildBasedChannel | null): PostChannelKind {
  if (!channel) return "missing";
  switch (channel.type) {
    case ChannelType.GuildText:
    case ChannelType.GuildAnnouncement:
      return "message-channel";
    case ChannelType.PublicThread:
    case ChannelType.PrivateThread:
    case ChannelType.AnnouncementThread:
      return "thread";
    default:
      // フォーラム・ボイス・カテゴリ等は対象外。
      return "unsupported";
  }
}

/** メンバーがそのチャンネルで見えて、(スレッドならスレッドでの)メッセージ送信ができるか。 */
function canSendIn(channel: GuildBasedChannel, member: GuildMember | null, isThread: boolean): boolean {
  if (!member) return false;
  const permissions = channel.permissionsFor(member);
  if (!permissions) return false;
  return (
    permissions.has(PermissionFlagsBits.ViewChannel) &&
    permissions.has(isThread ? PermissionFlagsBits.SendMessagesInThreads : PermissionFlagsBits.SendMessages)
  );
}

const noRoleIsMentionable = (): boolean => false;

/** 投稿直前の事実収集。キャッシュに頼らず、在籍・チャンネルはAPIで確認する(削除・退出直後でも正しく判定するため)。 */
async function inspectPost(client: Client, post: { guildId: string; channelId: string; authorId: string }): Promise<PostInspection> {
  const guild: Guild | null = client.guilds.cache.get(post.guildId) ?? (await client.guilds.fetch(post.guildId).catch(() => null));
  if (!guild) {
    // Botがサーバーから外れている。投稿先が存在しないものとして扱う。
    return {
      facts: {
        authorIsMember: true,
        authorRoleIds: [],
        channelKind: "missing",
        threadClosed: false,
        authorCanSend: false,
        botCanSend: false,
      },
      canMentionEveryone: false,
      isRoleMentionable: noRoleIsMentionable,
    };
  }

  const [member, channel, me] = await Promise.all([
    nullIfUnknown(guild.members.fetch(post.authorId), UNKNOWN_MEMBER),
    nullIfUnknown(guild.channels.fetch(post.channelId), UNKNOWN_CHANNEL),
    guild.members.fetchMe(),
  ]);

  const channelKind = channelKindOf(channel);
  const isThread = channelKind === "thread";
  const usable = channel !== null && (channelKind === "message-channel" || isThread);
  const facts: PostFacts = {
    authorIsMember: member !== null,
    authorRoleIds: member ? [...member.roles.cache.keys()] : [],
    channelKind,
    threadClosed: channel !== null && channel.isThread() && (channel.archived === true || channel.locked === true),
    authorCanSend: usable && canSendIn(channel, member, isThread),
    botCanSend: usable && canSendIn(channel, me, isThread),
  };
  return {
    facts,
    canMentionEveryone:
      usable && member !== null && (channel.permissionsFor(member)?.has(PermissionFlagsBits.MentionEveryone) ?? false),
    isRoleMentionable: (roleId) => guild.roles.cache.get(roleId)?.mentionable ?? false,
    channelName: channel?.name,
    authorName: member?.displayName,
    authorAvatarUrl: member?.displayAvatarURL({ size: 128 }),
  };
}

export function createDiscordGateway(client: Client): SchedulerGateway {
  return {
    inspect: (post) => inspectPost(client, post),
    send: async (post, view, mention) => {
      const channel = await client.channels.fetch(post.channelId);
      if (!channel || !channel.isSendable()) {
        throw Object.assign(new Error(`channel ${post.channelId} is not sendable`), { code: UNKNOWN_CHANNEL });
      }
      const message = await channel.send(buildPostMessage(post.content, view, mention));
      return { messageId: message.id };
    },
    sendDm: async (userId, text) => {
      const user = await client.users.fetch(userId);
      await user.send(text);
    },
  };
}
