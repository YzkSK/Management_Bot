import type { GuildDataTopic } from "@management-bot/shared";
import { useQueryClient, type QueryKey } from "@tanstack/react-query";
import { useEffect, useMemo } from "react";
import { createGuildDataInvalidator, parseGuildDataMessage } from "./guild-live-updates.js";
import { buildGuildWsUrl } from "./pages/log-notifications.js";
import { useGuildWs } from "./pages/use-guild-ws.js";
import { API_URL, trpc } from "./trpc.js";

/**
 * topicが変わったときに取り直すクエリ。ルーター丸ごとではなく、DBの変更で内容が変わるクエリに絞る
 * (Discord APIを叩く選択肢系クエリ=ロール/メンバー/チャンネル一覧は対象外)。
 * 新規ログの追加は既存の/ws/logsが担当する(loggingSettingsでは表示設定に依存するログ一覧も取り直す)。
 * tempVoice.listActiveChannelsはRedis由来のため、ここでは対象にせず画面側の定期取得に任せる。
 */
function queryKeysFor(topic: GuildDataTopic): readonly QueryKey[] {
  switch (topic) {
    case "auditLog":
      return [trpc.auditLog.list.pathKey(), trpc.auditLog.listFilterOptions.pathKey()];
    case "scheduledPost":
      return [trpc.scheduledPost.list.pathKey(), trpc.scheduledPost.getSettings.pathKey()];
    case "tempVoice":
      return [trpc.tempVoice.getConfig.pathKey(), trpc.tempVoice.getDenyProtectedRoles.pathKey()];
    case "moderation":
      return [
        trpc.moderation.listThresholds.pathKey(),
        trpc.moderation.listWhitelist.pathKey(),
        trpc.moderation.listStrikes.pathKey(),
        trpc.moderation.getEscalationPreset.pathKey(),
        trpc.moderation.getLockdownSettings.pathKey(),
        trpc.moderation.listNgwords.pathKey(),
      ];
    case "loggingSettings":
      // ログ一覧はサーバー側で表示設定(監査ログ相関・Botイベントを隠すか)を適用するため、一覧も取り直す。
      return [
        trpc.logging.listRetentionSettings.pathKey(),
        trpc.logging.listChannelSettings.pathKey(),
        trpc.logging.getDisplaySettings.pathKey(),
        trpc.logging.listLogEntries.pathKey(),
      ];
    case "access":
      // 自分の権限が変わりうるため、表示中の全クエリを取り直す。権限を失ったクエリはFORBIDDENになり、
      // dashboard-query-clientが保持していたデータを消す(ログの生データ表示等もここで切り替わる)。
      return [[]];
  }
}

/**
 * ギルド配下の全画面で1本だけ/ws/guild/:guildIdに接続し、通知されたtopicのクエリをinvalidateする。
 * 接続・再接続のたびに、接続前・切断中の取りこぼしを取り直すため全topicをinvalidateする。
 * guildIdが未指定なら接続しない。
 */
export function useGuildLiveUpdates(guildId: string | undefined): void {
  const queryClient = useQueryClient();
  const invalidator = useMemo(() => createGuildDataInvalidator(queryClient, queryKeysFor), [queryClient]);
  useEffect(() => () => invalidator.dispose(), [invalidator]);
  useGuildWs(
    guildId ? buildGuildWsUrl(API_URL, "guild", guildId) : "",
    (data) => {
      const topic = parseGuildDataMessage(data);
      if (topic) invalidator.notify(topic);
    },
    // 初回接続も含め毎回取り直す。各ページの初回取得〜WebSocket接続完了の間の変更を取りこぼさないため。
    () => invalidator.notifyAll(),
  );
}
