/** 秒数を "14h 20m" / "20m" の形にする(秒は切り捨て)。 */
export function formatDuration(seconds: number): string {
  const totalMinutes = Math.floor(seconds / 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
}

export interface ActivityMeSummary {
  totals: { messageCount: number; voiceSeconds: number };
  rank: { messages: number | null; voice: number | null };
  daily: readonly { bucket: string; messageCount: number; voiceSeconds: number }[];
}

/** `/activity me` の返信本文。dailyのbucketはYYYY-MM-DD(JST)。 */
export function buildActivityMeReply(summary: ActivityMeSummary, periodDays: number): string {
  const { totals, rank, daily } = summary;
  if (totals.messageCount === 0 && totals.voiceSeconds === 0) return `直近${periodDays}日のアクティビティはありません。`;
  const rankText = (value: number | null) => (value === null ? "-" : `${value}位`);
  return [
    `**直近${periodDays}日のアクティビティ**`,
    `発言数: ${totals.messageCount} / VC時間: ${formatDuration(totals.voiceSeconds)}`,
    `サーバー内順位: 発言 ${rankText(rank.messages)} / VC ${rankText(rank.voice)}`,
    "",
    ...daily.map((d) => `${d.bucket.slice(5).replace("-", "/")} 発言 ${d.messageCount} / VC ${formatDuration(d.voiceSeconds)}`),
  ].join("\n");
}
