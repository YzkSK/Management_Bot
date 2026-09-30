import { useQuery } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { isUnauthorizedError } from "./is-unauthorized-error.js";
import { logout } from "./logout.js";
import { trpc } from "./trpc.js";
import { Layout } from "./Layout.js";
import { AccessPage } from "./pages/AccessPage.js";
import { ActivityPage } from "./pages/ActivityPage.js";
import { GuildListPage } from "./pages/GuildListPage.js";
import { LogListPage } from "./pages/LogListPage.js";
import { ModerationPage } from "./pages/ModerationPage.js";
import { SettingsPage } from "./pages/SettingsPage.js";
import { NotFoundPage, StatusPage } from "./pages/StatusPage.js";
import { TempVoicePage } from "./pages/TempVoicePage.js";
import { LOGOUT_FAILED_MESSAGE } from "./pages/UserSettingsPage.js";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Loading } from "@/components/ui/skeleton";
import { toast } from "sonner";

export function App() {
  const me = useQuery(trpc.me.queryOptions());

  if (me.isPending) {
    return <Loading />;
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
    if (!(await logout())) toast.error(LOGOUT_FAILED_MESSAGE);
  };

  const { statusAccess } = me.data;
  const layout = (
    <Layout
      discordUsername={me.data.discordUsername}
      avatarUrl={me.data.avatarUrl}
      onLogout={handleLogout}
      showStatus={statusAccess !== null}
    />
  );

  return (
    <BrowserRouter>
      <Routes>
        <Route
          path="/"
          element={layout}
        >
          <Route index element={<GuildListPage />} />
        </Route>
        <Route
          path="/status"
          element={
            <Layout
              discordUsername={me.data.discordUsername}
              avatarUrl={me.data.avatarUrl}
              onLogout={handleLogout}
              showStatus={statusAccess !== null}
              showSidebar={false}
            />
          }
        >
          <Route index element={statusAccess ? <StatusPage isOwner={statusAccess === "owner"} /> : <NotFoundPage />} />
        </Route>
        <Route
          path="/guilds/:guildId"
          element={layout}
        >
          <Route path="activity" element={<ActivityPage />} />
          <Route path="logs" element={<LogListPage />} />
          <Route path="logs/settings" element={<SettingsPage />} />
          <Route path="moderation" element={<ModerationPage />} />
          <Route path="temp-voice" element={<TempVoicePage />} />
          <Route path="access" element={<AccessPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
