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
}

export function Layout({ discordUsername, avatarUrl, onLogout }: LayoutProps) {
  const { guildId } = useParams<{ guildId?: string }>();
  const [isSidebarOpen, setSidebarOpen] = useState(false);

  return (
    <Dialog open={isSidebarOpen} onOpenChange={setSidebarOpen}>
      <div className="flex min-h-screen flex-col">
        <Toaster richColors position="top-right" />
        <Header discordUsername={discordUsername} avatarUrl={avatarUrl} onLogout={onLogout} isSidebarOpen={isSidebarOpen} />
        <div className="flex flex-1">
          <Sidebar guildId={guildId} open={isSidebarOpen} onOpenChange={setSidebarOpen} />
          <main className="min-w-0 flex-1 p-4">
            <Outlet />
          </main>
        </div>
        <Footer />
      </div>
    </Dialog>
  );
}
