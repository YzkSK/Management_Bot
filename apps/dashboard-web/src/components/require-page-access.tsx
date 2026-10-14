import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useParams } from "react-router-dom";
import { CAPABILITIES, hasCapability, type CapabilityName } from "@management-bot/shared";
import { useGuildCapabilities } from "../guild-pages.js";
import { trpc } from "../trpc.js";
import { ErrorState, ForbiddenState, NotMemberState } from "./page-state.js";
import { Loading } from "@/components/ui/skeleton";

/**
 * ページ本体を描く前に、自分の実効capabilities(サーバー一覧と一緒に取得済み)で閲覧可否を判定する。
 * 判定がつくまでは読み込み表示のみ、権限がなければ本体を描かずに権限なしの表示を出す。
 * リロード直後に本体(0件の統計など)が一瞬映ってから権限なしの表示に切り替わるのを防ぐため。
 * 表示の出し分けのみで、認可は各procedureが最終的に強制する。
 */
export function RequirePageAccess({
  pageName,
  capability,
  children,
}: {
  pageName: string;
  /** 閲覧に必要なcapability。省略時はギルドメンバーなら誰でも(判定待ちの間だけ読み込み表示にする)。 */
  capability?: CapabilityName;
  children: ReactNode;
}) {
  const { guildId } = useParams<{ guildId: string }>();
  const guildsQuery = useQuery(trpc.guildSettings.listMyGuilds.queryOptions());
  const capabilities = useGuildCapabilities(guildId);
  // 一覧を一度も取得できていないまま失敗したら、読み込み表示で止まらないよう再読み込みできるエラー表示にする。
  // 取得済みの一覧があれば、再取得の一時的な失敗ではページを隠さずその一覧で判定を続ける。
  if (guildsQuery.isError && guildsQuery.data === undefined) {
    return <ErrorState subject="サーバーの情報" onRetry={() => void guildsQuery.refetch()} />;
  }
  if (capabilities === undefined || guildsQuery.data === undefined) return <Loading />;
  // 一覧に無いサーバー(未参加・Bot未導入)は、権限0のメンバーと区別してページ自体を開かせない。
  if (!guildsQuery.data.some((guild) => guild.id === guildId)) return <NotMemberState />;
  if (capability !== undefined && !hasCapability(capabilities, CAPABILITIES[capability])) {
    return <ForbiddenState pageName={pageName} capabilities={[capability]} />;
  }
  return <>{children}</>;
}
