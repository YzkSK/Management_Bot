import { useQuery } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { isUnauthorizedError } from "./is-unauthorized-error.js";
import { logout } from "./logout.js";
import { API_URL, trpc } from "./trpc.js";
import { Layout } from "./Layout.js";
import { RequirePageAccess } from "./components/require-page-access.js";
import { AccessPage } from "./pages/AccessPage.js";
import { AuditLogPage } from "./pages/AuditLogPage.js";
import { ActivityPage } from "./pages/ActivityPage.js";
import { GuildListPage } from "./pages/GuildListPage.js";
import { LogListPage } from "./pages/LogListPage.js";
import { ModerationPage } from "./pages/ModerationPage.js";
import { RolesPage } from "./pages/RolesPage.js";
import { ScheduledPostPage } from "./pages/ScheduledPostPage.js";
import { ScheduledPostSettingsPage } from "./pages/ScheduledPostSettingsPage.js";
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
          {/* 本体を描く前に閲覧可否を判定し、リロード時に権限のない画面が一瞬映るのを防ぐ */}
          <Route path="activity" element={<RequirePageAccess pageName="アクティビティ" capability="VIEW_ACTIVITY"><ActivityPage /></RequirePageAccess>} />
          <Route path="logs" element={<RequirePageAccess pageName="ログ" capability="VIEW_LOGS"><LogListPage /></RequirePageAccess>} />
          <Route path="logs/settings" element={<RequirePageAccess pageName="ログ設定" capability="MANAGE_LOGGING_SETTINGS"><SettingsPage /></RequirePageAccess>} />
          <Route path="moderation" element={<RequirePageAccess pageName="スパム対策" capability="MANAGE_MODERATION"><ModerationPage /></RequirePageAccess>} />
          <Route path="scheduled-post" element={<RequirePageAccess pageName="予約投稿"><ScheduledPostPage /></RequirePageAccess>} />
          <Route path="scheduled-post/settings" element={<RequirePageAccess pageName="予約投稿の設定" capability="MANAGE_SCHEDULED_POSTS"><ScheduledPostSettingsPage /></RequirePageAccess>} />
          <Route path="temp-voice" element={<RequirePageAccess pageName="一時VC"><TempVoicePage /></RequirePageAccess>} />
          <Route path="roles" element={<RequirePageAccess pageName="ロール管理" capability="VIEW_ROLES"><RolesPage /></RequirePageAccess>} />
          <Route path="access" element={<RequirePageAccess pageName="アクセス権限" capability="MANAGE_ACCESS"><AccessPage /></RequirePageAccess>} />
          <Route path="audit-log" element={<RequirePageAccess pageName="操作履歴" capability="VIEW_AUDIT_LOG"><AuditLogPage /></RequirePageAccess>} />
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
