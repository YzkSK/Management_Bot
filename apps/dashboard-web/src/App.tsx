import { useQuery } from "@tanstack/react-query";
import { TRPCClientError } from "@trpc/client";
import { useEffect } from "react";
import { API_URL, trpc } from "./trpc.js";
import { Sidebar } from "./Sidebar.js";

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
    return <div>読み込み中...</div>;
  }

  if (isUnauthorized) {
    return <div>ログインへリダイレクト中...</div>;
  }

  if (me.isError) {
    return <div role="alert">接続に失敗しました。時間をおいて再度お試しください。</div>;
  }

  return (
    <div style={{ display: "flex" }}>
      <Sidebar />
      <main>ようこそ</main>
    </div>
  );
}
