export interface VoiceSessionEndedInput {
  guildId: string;
  userId: string;
  channelId: string;
  startedAt: Date;
  endedAt: Date;
}

export interface VoiceSessionEndedEventPayload {
  type: "voice.session.ended";
  guildId: string;
  userId: string;
  channelId: string;
  startedAt: string;
  endedAt: string;
  durationSeconds: number;
}

/**
 * セッション開始・終了時刻からvoice.session.endedイベントのpayloadを組み立てる純粋関数。
 * endedAtがstartedAtより前(時刻巻き戻り等の異常系)の場合はendedAt=startedAt・durationSeconds=0に
 * 補正する。durationSecondsだけを0にクランプしendedAtを元のまま返すと、共有スキーマ
 * (packages/shared/src/domain-events.ts)のendedAt >= startedAt制約に違反してpublishがrejectされる
 * ため(codexレビュー指摘)、payload自体を制約を満たす形に補正する。
 */
export function buildVoiceSessionEndedEvent(input: VoiceSessionEndedInput): VoiceSessionEndedEventPayload {
  const durationMs = input.endedAt.getTime() - input.startedAt.getTime();
  const endedAt = durationMs < 0 ? input.startedAt : input.endedAt;
  const durationSeconds = Math.max(0, Math.round(durationMs / 1000));
  return {
    type: "voice.session.ended",
    guildId: input.guildId,
    userId: input.userId,
    channelId: input.channelId,
    startedAt: input.startedAt.toISOString(),
    endedAt: endedAt.toISOString(),
    durationSeconds,
  };
}
