import { Outlet, useParams } from "react-router-dom";
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
  return (
    <div className="flex min-h-screen flex-col">
      <Header discordUsername={discordUsername} avatarUrl={avatarUrl} onLogout={onLogout} />
      <div className="flex flex-1">
        <Sidebar guildId={guildId} />
        <main className="flex-1 p-4">
          <Outlet />
        </main>
      </div>
      <Footer />
    </div>
  );
}
