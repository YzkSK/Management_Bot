import { useQuery } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { isUnauthorizedError } from "./is-unauthorized-error.js";
import { API_URL, trpc } from "./trpc.js";
import { Layout } from "./Layout.js";
import { AccessPage } from "./pages/AccessPage.js";
import { GuildListPage } from "./pages/GuildListPage.js";
import { LogListPage } from "./pages/LogListPage.js";
import { SettingsPage } from "./pages/SettingsPage.js";
import { Alert, AlertDescription } from "@/components/ui/alert";

export function App() {
  const me = useQuery(trpc.me.queryOptions());

  if (me.isPending) {
    return <div className="p-4 text-sm">読み込み中...</div>;
  }

  if (isUnauthorizedError(me.error)) {
    return <div className="p-4 text-sm">ログインへリダイレクト中...</div>;
  }

  if (me.isError) {
    return (
      <div className="p-4">
        <Alert variant="destructive">
          <AlertDescription>接続に失敗しました。時間をおいて再度お試しください。</AlertDescription>
        </Alert>
      </div>
    );
  }

  const handleLogout = async () => {
    const response = await fetch(`${API_URL}/auth/logout`, { method: "POST", credentials: "include" });
    if (!response.ok) {
      window.alert("ログアウトに失敗しました。時間をおいて再度お試しください。");
      return;
    }
    window.location.href = `${API_URL}/auth/login`;
  };

  return (
    <BrowserRouter>
      <Routes>
        <Route
          path="/"
          element={
            <Layout discordUsername={me.data.discordUsername} avatarUrl={me.data.avatarUrl} onLogout={handleLogout} />
          }
        >
          <Route index element={<GuildListPage />} />
        </Route>
        <Route
          path="/guilds/:guildId"
          element={
            <Layout discordUsername={me.data.discordUsername} avatarUrl={me.data.avatarUrl} onLogout={handleLogout} />
          }
        >
          <Route path="logs" element={<LogListPage />} />
          <Route path="logs/settings" element={<SettingsPage />} />
          <Route path="access" element={<AccessPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
