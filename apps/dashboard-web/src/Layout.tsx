import { useState } from "react";
import { Outlet, useParams } from "react-router-dom";
import { Toaster } from "sonner";
import { Header } from "./Header.js";
import { Sidebar } from "./Sidebar.js";
import { Footer } from "./Footer.js";
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

  return (
    <Dialog open={isSidebarOpen} onOpenChange={setSidebarOpen}>
      <div className="flex h-dvh flex-col overflow-hidden">
        <Toaster richColors position="top-right" />
        <Header
          discordUsername={discordUsername} avatarUrl={avatarUrl} onLogout={onLogout} isSidebarOpen={isSidebarOpen} showStatus={showStatus}
          showMenuButton={showSidebar}
        />
        <div className="flex min-h-0 flex-1">
          {showSidebar && <Sidebar guildId={guildId} open={isSidebarOpen} onOpenChange={setSidebarOpen} />}
          <main className="bg-muted/40 min-w-0 flex-1 overflow-y-auto p-4 md:p-8">
            <Outlet />
          </main>
        </div>
        <Footer />
      </div>
    </Dialog>
  );
}
