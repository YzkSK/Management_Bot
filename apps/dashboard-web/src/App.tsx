import { useQuery } from "@tanstack/react-query";
import { TRPCClientError } from "@trpc/client";
import { useEffect } from "react";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { API_URL, trpc } from "./trpc.js";
import { Layout } from "./Layout.js";
import { GuildListPage } from "./pages/GuildListPage.js";
import { LogListPage } from "./pages/LogListPage.js";
import { Alert, AlertDescription } from "@/components/ui/alert";

export function isUnauthorizedError(error: unknown): boolean {
  return error instanceof TRPCClientError && error.data?.code === "UNAUTHORIZED";
}

export function App() {
  const me = useQuery(trpc.me.queryOptions());
  const isUnauthorized = isUnauthorizedError(me.error);

  useEffect(() => {
    if (isUnauthorized) {
      window.location.href = `${API_URL}/auth/login`;
    }
  }, [isUnauthorized]);

  if (me.isPending) {
    return <div className="p-4 text-sm">読み込み中...</div>;
  }

  if (isUnauthorized) {
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
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
