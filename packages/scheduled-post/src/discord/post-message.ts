import {
  ContainerBuilder,
  SectionBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  TextDisplayBuilder,
  ThumbnailBuilder,
  escapeMarkdown,
} from "discord.js";

export interface PostView {
  /** 予約者の投稿時点のサーバー表示名。 */
  authorName: string;
  /** 予約者のギルドアバター(なければユーザーアバター)のURL。 */
  authorAvatarUrl: string;
}

/**
 * 予約投稿の表示(Components V2)。Container内に
 * Section(予約者の表示名(太字)+アバターのThumbnail) → Separator → 本文のTextDisplay。
 * Bot名義で送信される。メンションの通知可否はsend時のallowedMentionsで制御する。
 */
export function buildPostContainer(content: string, view: PostView): ContainerBuilder {
  return new ContainerBuilder()
    .addSectionComponents(
      new SectionBuilder()
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(`**${escapeMarkdown(view.authorName)}**`))
        .setThumbnailAccessory(new ThumbnailBuilder().setURL(view.authorAvatarUrl)),
    )
    .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(content));
}
