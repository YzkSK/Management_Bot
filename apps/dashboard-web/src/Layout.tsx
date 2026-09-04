import { Outlet } from "react-router-dom";
import { Header } from "./Header.js";
import { Sidebar } from "./Sidebar.js";
import { Footer } from "./Footer.js";

interface LayoutProps {
  discordUserId: string;
}

export function Layout({ discordUserId }: LayoutProps) {
  return (
    <div style={{ display: "flex", flexDirection: "column", minHeight: "100vh" }}>
      <Header discordUserId={discordUserId} />
      <div style={{ display: "flex", flex: 1 }}>
        <Sidebar />
        <main style={{ flex: 1, padding: "1rem" }}>
          <Outlet />
        </main>
      </div>
      <Footer />
    </div>
  );
}
