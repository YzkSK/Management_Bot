import { useMutation } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Outlet, useParams } from "react-router-dom";
import { Toaster } from "sonner";
import { Header } from "./Header.js";
import { Sidebar } from "./Sidebar.js";
import { Footer } from "./Footer.js";
import { trpc } from "./trpc.js";
import { useGuildLiveUpdates } from "./use-guild-live-updates.js";
import { Dialog } from "@/components/ui/dialog";

interface LayoutProps {
  discordUsername: string;
  avatarUrl: string | null;
  onLogout: () => void;
  showStatus: boolean;
  /** Bot全体のステータス画面はサーバーに属さないため、サイドバーを出さない(モック準拠)。 */
  showSidebar?: boolean;
}

export function Layout({ discordUsername, avatarUrl, onLogout, showStatus, showSidebar = true }: LayoutProps) {
  const { guildId } = useParams<{ guildId?: string }>();
  const [isSidebarOpen, setSidebarOpen] = useState(false);
  // ギルドの管理画面を開いたことをアクセス履歴に記録する(guildIdが変わったとき1回。同一人物・ギルドは
  // サーバー側で30分にまとめる)。失敗しても画面表示は妨げない。
  const { mutate: recordAccess } = useMutation(trpc.auditLog.recordAccess.mutationOptions());
  useEffect(() => {
    if (guildId) recordAccess({ guildId });
  }, [guildId, recordAccess]);
  // ギルド配下の全画面で、他の人・Botによるデータ変更を自動反映する(issue #643)。
  useGuildLiveUpdates(guildId);
  // サーバー選択画面(guildId未指定)ではサイドバーを出さない(issue #527)。
  const sidebarVisible = showSidebar && Boolean(guildId);

  return (
    <Dialog open={isSidebarOpen} onOpenChange={setSidebarOpen}>
      <div className="flex h-dvh flex-col overflow-hidden">
        <Toaster richColors position="top-right" />
        <Header
          discordUsername={discordUsername} avatarUrl={avatarUrl} onLogout={onLogout} isSidebarOpen={isSidebarOpen} showStatus={showStatus}
          showMenuButton={sidebarVisible}
        />
        <div className="flex min-h-0 flex-1">
          {sidebarVisible && <Sidebar guildId={guildId} open={isSidebarOpen} onOpenChange={setSidebarOpen} />}
          <main className="bg-muted/40 min-w-0 flex-1 overflow-y-auto p-4 md:p-8">
            <Outlet />
          </main>
        </div>
        <Footer />
      </div>
    </Dialog>
  );
}
