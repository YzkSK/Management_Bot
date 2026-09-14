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
 * (category, action)ごとのアクセント分類とタイトル文言。全カテゴリ×actionを明示的に列挙する
 * (命名規則からの推測は「archive」「resolve」のような分類が曖昧な語で誤判定するため避ける)。
 */
const PRESENTATION: { [C in LogEntry["category"]]?: Partial<Record<string, { accent: AccentKind; title: string }>> } = {
  message: {
    create: { accent: "positive", title: "メッセージが投稿されました" },
    update: { accent: "warning", title: "メッセージが編集されました" },
    delete: { accent: "negative", title: "メッセージが削除されました" },
    bulkDelete: { accent: "negative", title: "メッセージが一括削除されました" },
    pin: { accent: "warning", title: "メッセージがピン留めされました" },
    unpin: { accent: "warning", title: "メッセージのピン留めが解除されました" },
  },
  reaction: {
    add: { accent: "positive", title: "リアクションが追加されました" },
    remove: { accent: "negative", title: "リアクションが削除されました" },
  },
  member: {
    join: { accent: "positive", title: "ユーザーが参加しました" },
    leave: { accent: "negative", title: "ユーザーが退出しました" },
    ban: { accent: "negative", title: "ユーザーがBANされました" },
    unban: { accent: "positive", title: "ユーザーのBANが解除されました" },
    kick: { accent: "negative", title: "ユーザーがキックされました" },
    timeout: { accent: "warning", title: "ユーザーがタイムアウトされました" },
    timeoutRemove: { accent: "positive", title: "ユーザーのタイムアウトが解除されました" },
    nicknameChange: { accent: "warning", title: "ニックネームが変更されました" },
  },
  role: {
    create: { accent: "positive", title: "ロールが作成されました" },
    update: { accent: "warning", title: "ロールが更新されました" },
    delete: { accent: "negative", title: "ロールが削除されました" },
    memberAdd: { accent: "positive", title: "ロールが付与されました" },
    memberRemove: { accent: "negative", title: "ロールが剥奪されました" },
  },
  channel: {
    create: { accent: "positive", title: "チャンネルが作成されました" },
    update: { accent: "warning", title: "チャンネルが更新されました" },
    delete: { accent: "negative", title: "チャンネルが削除されました" },
  },
  guild: {
    update: { accent: "warning", title: "サーバー設定が更新されました" },
  },
  thread: {
    create: { accent: "positive", title: "スレッドが作成されました" },
    update: { accent: "warning", title: "スレッドが更新されました" },
    delete: { accent: "negative", title: "スレッドが削除されました" },
    archive: { accent: "negative", title: "スレッドがアーカイブされました" },
    unarchive: { accent: "positive", title: "スレッドのアーカイブが解除されました" },
    memberAdd: { accent: "positive", title: "スレッドにメンバーが参加しました" },
    memberRemove: { accent: "negative", title: "スレッドからメンバーが退出しました" },
  },
  invite: {
    create: { accent: "positive", title: "招待が作成されました" },
    delete: { accent: "negative", title: "招待が削除されました" },
  },
  emoji: {
    create: { accent: "positive", title: "絵文字が追加されました" },
    update: { accent: "warning", title: "絵文字が更新されました" },
    delete: { accent: "negative", title: "絵文字が削除されました" },
  },
  sticker: {
    create: { accent: "positive", title: "スタンプが追加されました" },
    update: { accent: "warning", title: "スタンプが更新されました" },
    delete: { accent: "negative", title: "スタンプが削除されました" },
  },
  autoMod: {
    ruleCreate: { accent: "positive", title: "AutoModルールが作成されました" },
    ruleUpdate: { accent: "warning", title: "AutoModルールが更新されました" },
    ruleDelete: { accent: "negative", title: "AutoModルールが削除されました" },
    actionExecuted: { accent: "negative", title: "AutoModが実行されました" },
  },
  integration: {
    create: { accent: "positive", title: "連携が追加されました" },
    update: { accent: "warning", title: "連携が更新されました" },
    delete: { accent: "negative", title: "連携が削除されました" },
  },
  poll: {
    create: { accent: "positive", title: "投票が開始されました" },
    end: { accent: "neutral", title: "投票が終了しました" },
  },
  scheduledEvent: {
    create: { accent: "positive", title: "イベントが作成されました" },
    update: { accent: "warning", title: "イベントが更新されました" },
    delete: { accent: "negative", title: "イベントが削除されました" },
    start: { accent: "positive", title: "イベントが開始されました" },
    complete: { accent: "neutral", title: "イベントが終了しました" },
    cancel: { accent: "negative", title: "イベントがキャンセルされました" },
  },
  stage: {
    start: { accent: "positive", title: "ステージが開始されました" },
    update: { accent: "warning", title: "ステージが更新されました" },
    end: { accent: "negative", title: "ステージが終了しました" },
  },
  auditLogCorrelation: {},
  moderationCase: {
    create: { accent: "negative", title: "モデレーション対応が記録されました" },
    update: { accent: "warning", title: "モデレーション対応が更新されました" },
    resolve: { accent: "positive", title: "モデレーション対応が解決しました" },
  },
  voice: {
    join: { accent: "positive", title: "ボイスチャンネルに参加しました" },
    leave: { accent: "negative", title: "ボイスチャンネルから退出しました" },
    move: { accent: "warning", title: "ボイスチャンネルを移動しました" },
    update: { accent: "warning", title: "ボイス状態が更新されました" },
  },
};

const FALLBACK = { accent: "neutral" as const, title: "ログイベント" };

export function getPresentation(entry: LogEntry): { accent: AccentKind; title: string } {
  if (entry.category === "auditLogCorrelation") return FALLBACK;
  return PRESENTATION[entry.category]?.[entry.action] ?? FALLBACK;
}
