import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { logout } from "../logout.js";
import { getStoredTheme, setTheme, type Theme } from "../theme.js";
import { trpc } from "../trpc.js";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const THEME_OPTIONS: readonly { value: Theme; label: string }[] = [
  { value: "light", label: "ライト" },
  { value: "dark", label: "ダーク" },
  { value: "system", label: "システム" },
];

export const LOGOUT_FAILED_MESSAGE = "ログアウトに失敗しました。時間をおいて再度お試しください。";

export function UserSettingsPage() {
  const me = useQuery(trpc.me.queryOptions());
  const [theme, setThemeState] = useState<Theme>(() => getStoredTheme());
  const [loggingOut, setLoggingOut] = useState(false);

  const handleLogout = async () => {
    setLoggingOut(true);
    if (!(await logout())) {
      toast.error(LOGOUT_FAILED_MESSAGE);
      setLoggingOut(false);
    }
  };

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-5">
      <Link to="/" className="w-fit text-sm hover:underline">
        ← サーバー一覧へ戻る
      </Link>
      <h1 className="text-2xl font-bold">ユーザー設定</h1>

      <section className="bg-card flex items-center gap-4 rounded-xl border p-5">
        {me.data?.avatarUrl ? (
          <img src={me.data.avatarUrl} alt="" className="size-14 shrink-0 rounded-full" />
        ) : (
          <span className="bg-muted flex size-14 shrink-0 items-center justify-center rounded-full text-xl font-bold" aria-hidden="true">
            {me.data?.discordUsername.slice(0, 1).toUpperCase()}
          </span>
        )}
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="truncate font-bold">{me.data?.discordUsername}</span>
          <span className="text-muted-foreground text-sm">Discordアカウントでログイン中</span>
        </div>
        <Button type="button" variant="outline" disabled={loggingOut} onClick={() => void handleLogout()}>
          ログアウト
        </Button>
      </section>

      <section className="bg-card flex flex-col gap-4 rounded-xl border p-5">
        <h2 className="font-bold">表示</h2>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span id="theme-label" className="text-sm">
            テーマ
          </span>
          <div role="radiogroup" aria-labelledby="theme-label" className="bg-muted flex gap-0.5 rounded-lg p-1">
            {THEME_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={option.value === theme}
                onClick={() => {
                  setTheme(option.value);
                  setThemeState(option.value);
                }}
                className={cn(
                  "h-9 rounded-md px-4 text-sm",
                  option.value === theme ? "bg-background font-medium shadow-xs" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
      </section>

      <p className="text-muted-foreground text-xs">表示の設定はこのブラウザに保存されます。</p>
    </div>
  );
}
