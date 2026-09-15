import type { LogEntry } from "../domain/index.js";

export type AccentKind = "positive" | "negative" | "warning" | "neutral";

/** ContainerBuilder.setAccentColorに渡すRGB整数。Discordクライアントのダークテーマ上で視認しやすい彩度に合わせる。 */
export const ACCENT_COLORS: Record<AccentKind, number> = {
  positive: 0x3ba55c,
  negative: 0xf23f42,
  warning: 0xf0b232,
  neutral: 0x80848e,
};

/**
 * (category, action)ごとのアクセント分類・タイトル文言・タイトル行の絵文字アイコン。
 * 全カテゴリ×actionを明示的に列挙する(命名規則からの推測は「archive」「resolve」のような
 * 分類が曖昧な語で誤判定するため避ける)。iconはaccentの4分類より細かく、操作の意味
 * (参加/退出/BAN/タイムアウト/編集等)が一目で伝わるものを選ぶ。同じ意味の操作は
 * カテゴリを跨いでも同じ絵文字にする(例: create系は📥、delete系は🗑️で統一しつつ、
 * BAN/kick/timeoutのような強い制裁は専用の絵文字を割り当てる)。
 */
const PRESENTATION: {
  [C in LogEntry["category"]]?: Partial<Record<string, { accent: AccentKind; title: string; icon: string }>>;
} = {
  message: {
    create: { accent: "positive", title: "メッセージが投稿されました", icon: "📥" },
    update: { accent: "warning", title: "メッセージが編集されました", icon: "✏️" },
    delete: { accent: "negative", title: "メッセージが削除されました", icon: "🗑️" },
    bulkDelete: { accent: "negative", title: "メッセージが一括削除されました", icon: "🧹" },
    pin: { accent: "warning", title: "メッセージがピン留めされました", icon: "📌" },
    unpin: { accent: "warning", title: "メッセージのピン留めが解除されました", icon: "📌" },
  },
  reaction: {
    add: { accent: "positive", title: "リアクションが追加されました", icon: "😀" },
    remove: { accent: "negative", title: "リアクションが削除されました", icon: "😀" },
  },
  member: {
    join: { accent: "positive", title: "ユーザーが参加しました", icon: "📥" },
    leave: { accent: "negative", title: "ユーザーが退出しました", icon: "📤" },
    ban: { accent: "negative", title: "ユーザーがBANされました", icon: "🔨" },
    unban: { accent: "positive", title: "ユーザーのBANが解除されました", icon: "🔓" },
    kick: { accent: "negative", title: "ユーザーがキックされました", icon: "👢" },
    timeout: { accent: "warning", title: "ユーザーがタイムアウトされました", icon: "🔇" },
    timeoutRemove: { accent: "positive", title: "ユーザーのタイムアウトが解除されました", icon: "🔊" },
    nicknameChange: { accent: "warning", title: "ニックネームが変更されました", icon: "✏️" },
  },
  role: {
    create: { accent: "positive", title: "ロールが作成されました", icon: "🆕" },
    update: { accent: "warning", title: "ロールが更新されました", icon: "✏️" },
    delete: { accent: "negative", title: "ロールが削除されました", icon: "🗑️" },
    memberAdd: { accent: "positive", title: "ロールが付与されました", icon: "🏷️" },
    memberRemove: { accent: "negative", title: "ロールが剥奪されました", icon: "🏷️" },
  },
  channel: {
    create: { accent: "positive", title: "チャンネルが作成されました", icon: "🆕" },
    update: { accent: "warning", title: "チャンネルが更新されました", icon: "✏️" },
    delete: { accent: "negative", title: "チャンネルが削除されました", icon: "🗑️" },
  },
  guild: {
    update: { accent: "warning", title: "サーバー設定が更新されました", icon: "⚙️" },
  },
  thread: {
    create: { accent: "positive", title: "スレッドが作成されました", icon: "🆕" },
    update: { accent: "warning", title: "スレッドが更新されました", icon: "✏️" },
    delete: { accent: "negative", title: "スレッドが削除されました", icon: "🗑️" },
    archive: { accent: "negative", title: "スレッドがアーカイブされました", icon: "📦" },
    unarchive: { accent: "positive", title: "スレッドのアーカイブが解除されました", icon: "📦" },
    memberAdd: { accent: "positive", title: "スレッドにメンバーが参加しました", icon: "📥" },
    memberRemove: { accent: "negative", title: "スレッドからメンバーが退出しました", icon: "📤" },
  },
  invite: {
    create: { accent: "positive", title: "招待が作成されました", icon: "🔗" },
    delete: { accent: "negative", title: "招待が削除されました", icon: "🔗" },
  },
  emoji: {
    create: { accent: "positive", title: "絵文字が追加されました", icon: "🙂" },
    update: { accent: "warning", title: "絵文字が更新されました", icon: "🙂" },
    delete: { accent: "negative", title: "絵文字が削除されました", icon: "🙂" },
  },
  sticker: {
    create: { accent: "positive", title: "スタンプが追加されました", icon: "🏷️" },
    update: { accent: "warning", title: "スタンプが更新されました", icon: "🏷️" },
    delete: { accent: "negative", title: "スタンプが削除されました", icon: "🏷️" },
  },
  autoMod: {
    ruleCreate: { accent: "positive", title: "AutoModルールが作成されました", icon: "🛡️" },
    ruleUpdate: { accent: "warning", title: "AutoModルールが更新されました", icon: "🛡️" },
    ruleDelete: { accent: "negative", title: "AutoModルールが削除されました", icon: "🛡️" },
    actionExecuted: { accent: "negative", title: "AutoModが実行されました", icon: "🚨" },
  },
  integration: {
    create: { accent: "positive", title: "連携が追加されました", icon: "🔌" },
    update: { accent: "warning", title: "連携が更新されました", icon: "🔌" },
    delete: { accent: "negative", title: "連携が削除されました", icon: "🔌" },
  },
  poll: {
    create: { accent: "positive", title: "投票が開始されました", icon: "📊" },
    end: { accent: "neutral", title: "投票が終了しました", icon: "📊" },
  },
  scheduledEvent: {
    create: { accent: "positive", title: "イベントが作成されました", icon: "📅" },
    update: { accent: "warning", title: "イベントが更新されました", icon: "📅" },
    delete: { accent: "negative", title: "イベントが削除されました", icon: "📅" },
    start: { accent: "positive", title: "イベントが開始されました", icon: "▶️" },
    complete: { accent: "neutral", title: "イベントが終了しました", icon: "🏁" },
    cancel: { accent: "negative", title: "イベントがキャンセルされました", icon: "🚫" },
  },
  stage: {
    start: { accent: "positive", title: "ステージが開始されました", icon: "🎙️" },
    update: { accent: "warning", title: "ステージが更新されました", icon: "🎙️" },
    end: { accent: "negative", title: "ステージが終了しました", icon: "🎙️" },
  },
  auditLogCorrelation: {},
  moderationCase: {
    create: { accent: "negative", title: "モデレーション対応が記録されました", icon: "🛑" },
    update: { accent: "warning", title: "モデレーション対応が更新されました", icon: "🛑" },
    resolve: { accent: "positive", title: "モデレーション対応が解決しました", icon: "✅" },
  },
  voice: {
    join: { accent: "positive", title: "ボイスチャンネルに参加しました", icon: "🔊" },
    leave: { accent: "negative", title: "ボイスチャンネルから退出しました", icon: "🔇" },
    move: { accent: "warning", title: "ボイスチャンネルを移動しました", icon: "↔️" },
    update: { accent: "warning", title: "ボイス状態が更新されました", icon: "🎚️" },
  },
};

const FALLBACK = { accent: "neutral" as const, title: "ログイベント", icon: "ℹ️" };

export function getPresentation(entry: LogEntry): { accent: AccentKind; title: string; icon: string } {
  if (entry.category === "auditLogCorrelation") return FALLBACK;
  return PRESENTATION[entry.category]?.[entry.action] ?? FALLBACK;
}
