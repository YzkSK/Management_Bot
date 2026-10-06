import { EmbedBuilder } from "discord.js";

export interface PostView {
  /** 予約者の投稿時点のサーバー表示名。 */
  authorName: string;
  /** 予約者のギルドアバター(なければユーザーアバター)のURL。 */
  authorAvatarUrl: string;
}

const EMBED_AUTHOR_NAME_MAX = 256;

/**
 * 予約投稿の表示。Embedのauthorに予約者の表示名とアバター(左上)、descriptionに本文を入れる。
 * Bot名義で送信される。Embed内のメンションはDiscordの仕様上通知されない。
 */
export function buildPostEmbed(content: string, view: PostView): EmbedBuilder {
  return new EmbedBuilder()
    .setAuthor({
      name: view.authorName.slice(0, EMBED_AUTHOR_NAME_MAX),
      ...(view.authorAvatarUrl ? { iconURL: view.authorAvatarUrl } : {}),
    })
    .setDescription(content);
}
