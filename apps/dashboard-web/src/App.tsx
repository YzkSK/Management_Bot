import { useQuery } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { isUnauthorizedError } from "./is-unauthorized-error.js";
import { trpc } from "./trpc.js";
import { Layout } from "./Layout.js";
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

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Layout discordUserId={me.data.discordUserId} />}>
          <Route index element={<GuildListPage />} />
        </Route>
        <Route path="/guilds/:guildId" element={<Layout discordUserId={me.data.discordUserId} />}>
          <Route path="logs" element={<LogListPage />} />
          <Route path="logs/settings" element={<SettingsPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
