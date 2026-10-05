import { useQuery } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { isUnauthorizedError } from "./is-unauthorized-error.js";
import { logout } from "./logout.js";
import { API_URL, trpc } from "./trpc.js";
import { Layout } from "./Layout.js";
import { AccessPage } from "./pages/AccessPage.js";
import { ActivityPage } from "./pages/ActivityPage.js";
import { GuildListPage } from "./pages/GuildListPage.js";
import { LogListPage } from "./pages/LogListPage.js";
import { ModerationPage } from "./pages/ModerationPage.js";
import { ScheduledPostPage } from "./pages/ScheduledPostPage.js";
import { SettingsPage } from "./pages/SettingsPage.js";
import { NotFoundPage, StatusPage } from "./pages/StatusPage.js";
import { TempVoicePage } from "./pages/TempVoicePage.js";
import { LOGOUT_FAILED_MESSAGE } from "./pages/UserSettingsPage.js";
import { Button } from "@/components/ui/button";
import { Loader2Icon } from "lucide-react";
import { toast } from "sonner";

export function App() {
  const me = useQuery(trpc.me.queryOptions());

  if (me.isPending) {
    return <AppStateScreen view="boot" />;
  }

  if (isUnauthorizedError(me.error)) {
    return <AppStateScreen view="redirect" />;
  }

  if (me.isError) {
    return <AppStateScreen view="error" />;
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
          <Route path="scheduled-post" element={<ScheduledPostPage />} />
          <Route path="temp-voice" element={<TempVoicePage />} />
          <Route path="access" element={<AccessPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

/** ログイン確認中・リダイレクト中・接続失敗を中央カードで出す。 */
export function AppStateScreen({ view }: { view: "boot" | "redirect" | "error" }) {
  const spinner = <Loader2Icon className="size-7 animate-spin" aria-hidden="true" />;
  return (
    <div className="bg-muted/40 flex min-h-screen items-center justify-center p-4">
      <div className="bg-card flex w-full max-w-[420px] flex-col items-center gap-3.5 rounded-2xl border p-8 text-center">
        <span className="text-base font-bold">Management Bot</span>
        {view === "boot" && (
          <>
            {spinner}
            <p role="status" className="text-muted-foreground text-sm">読み込み中...</p>
          </>
        )}
        {view === "redirect" && (
          <>
            {spinner}
            <p role="status" className="text-muted-foreground text-sm">Discordのログイン画面へ移動しています...</p>
            <a href={`${API_URL}/auth/login`} className="text-[13px] underline">移動しない場合はこちら</a>
          </>
        )}
        {view === "error" && (
          <>
            <p role="alert" className="text-destructive text-sm">接続に失敗しました。時間をおいて再度お試しください。</p>
            <Button className="h-11 px-5" onClick={() => window.location.reload()}>再読み込み</Button>
          </>
        )}
      </div>
    </div>
  );
}
