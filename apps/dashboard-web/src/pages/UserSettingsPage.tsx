import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { logout } from "../logout.js";
import { getStoredTheme, setTheme, type Theme } from "../theme.js";
import { trpc } from "../trpc.js";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { X } from "lucide-react";
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
    <div className="flex w-full flex-col gap-5">
      <section id="user-settings-account" className="bg-card flex items-center gap-4 rounded-xl border p-5">
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

      <section id="user-settings-display" className="bg-card flex flex-col gap-4 rounded-xl border p-5">
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

/** ページ遷移せず、今の画面に重ねて開くユーザー設定(Discordの設定画面と同じ見せ方)。 */
export function UserSettingsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="inset-4 flex overflow-hidden rounded-xl border shadow-2xl md:inset-x-[max(1rem,calc(50%-36rem))] md:inset-y-12">
        <nav className="bg-muted/40 hidden w-56 shrink-0 flex-col gap-1 border-r p-4 md:flex" aria-label="ユーザー設定の項目">
          <DialogTitle className="text-muted-foreground px-2 py-1 text-xs font-bold">ユーザー設定</DialogTitle>
          <a href="#user-settings-account" className="hover:bg-accent rounded-md px-2 py-1.5 text-sm">
            アカウント
          </a>
          <a href="#user-settings-display" className="hover:bg-accent rounded-md px-2 py-1.5 text-sm">
            表示
          </a>
        </nav>
        <div className="min-w-0 flex-1 overflow-y-auto p-6 md:p-10">
          <div className="mx-auto flex max-w-2xl flex-col gap-5">
            <h2 className="text-2xl font-bold">ユーザー設定</h2>
            <DialogDescription className="sr-only">アカウントと表示の設定</DialogDescription>
            <UserSettingsPage />
          </div>
        </div>
        <DialogClose asChild>
          <Button type="button" variant="ghost" size="icon" className="absolute top-3 right-3" aria-label="閉じる">
            <X className="size-5" />
          </Button>
        </DialogClose>
      </DialogContent>
    </Dialog>
  );
}
