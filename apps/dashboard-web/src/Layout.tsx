import { Outlet, useParams } from "react-router-dom";
import { Header } from "./Header.js";
import { Sidebar } from "./Sidebar.js";
import { Footer } from "./Footer.js";

interface LayoutProps {
  discordUserId: string;
}

export function Layout({ discordUserId }: LayoutProps) {
  const { guildId } = useParams<{ guildId?: string }>();
  return (
    <div className="flex min-h-screen flex-col">
      <Header discordUserId={discordUserId} />
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
