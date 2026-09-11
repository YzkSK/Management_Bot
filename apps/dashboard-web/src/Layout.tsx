import { useEffect, useState } from "react";
import { Outlet, useLocation, useParams } from "react-router-dom";
import { Toaster } from "sonner";
import { Header } from "./Header.js";
import { Sidebar } from "./Sidebar.js";
import { Footer } from "./Footer.js";

interface LayoutProps {
  discordUsername: string;
  avatarUrl: string | null;
  onLogout: () => void;
}

export function Layout({ discordUsername, avatarUrl, onLogout }: LayoutProps) {
  const { guildId } = useParams<{ guildId?: string }>();
  const location = useLocation();
  const [isSidebarOpen, setSidebarOpen] = useState(false);

  // ページ遷移時にモバイルのドロワーを自動で閉じる。
  useEffect(() => {
    setSidebarOpen(false);
  }, [location.pathname]);

  return (
    <div className="flex min-h-screen flex-col">
      <Toaster richColors position="top-right" />
      <Header
        discordUsername={discordUsername}
        avatarUrl={avatarUrl}
        onLogout={onLogout}
        onToggleSidebar={() => setSidebarOpen((v) => !v)}
      />
      <div className="flex flex-1">
        {isSidebarOpen && (
          <div
            className="fixed inset-0 z-30 bg-black/50 md:hidden"
            onClick={() => setSidebarOpen(false)}
            aria-hidden="true"
          />
        )}
        <Sidebar guildId={guildId} open={isSidebarOpen} />
        <main className="min-w-0 flex-1 p-4">
          <Outlet />
        </main>
      </div>
      <Footer />
    </div>
  );
}
