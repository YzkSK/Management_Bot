import { useQuery } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { IconChevronDown, IconMenu2 } from "@tabler/icons-react";
import { Link } from "react-router-dom";
import { Button } from "@/components/starwind/button";
import { DialogTrigger } from "@/components/starwind/dialog";
import { MOBILE_SIDEBAR_DIALOG_ID } from "./Sidebar.js";
import {
  Dropdown,
  DropdownContent,
  DropdownItem,
  DropdownSeparator,
  DropdownTrigger,
} from "@/components/starwind/dropdown";
import { cn } from "@/lib/utils";
import { UserSettingsDialog } from "./pages/UserSettingsPage.js";
import { STATUS_REFETCH_MS } from "./pages/StatusPage.js";
import { STATE_META } from "./pages/status-labels.js";
import { trpc } from "./trpc.js";

interface HeaderProps {
  discordUsername: string;
  avatarUrl: string | null;
  onLogout: () => void;
  isSidebarOpen: boolean;
  /** Bot全体ステータスの閲覧者(オーナー・許可ユーザー)にだけ状態ランプを出す(issue #507)。 */
  showStatus?: boolean;
  showMenuButton?: boolean;
}

/** ステータス画面と同じクエリを共有し、同じ30秒間隔で更新する。取得できない間は何も出さない。 */
function StatusLamp() {
  const overview = useQuery({ ...trpc.status.overview.queryOptions(), refetchInterval: STATUS_REFETCH_MS });
  if (!overview.data) return null;
  const meta = STATE_META[overview.data.summary];
  return (
    <Link
      to="/status"
      aria-label={`ステータス: ${meta.lamp}`}
      title={`ステータス: ${meta.lamp}`}
      className="text-muted-foreground hover:bg-accent flex h-11 min-w-11 shrink-0 items-center justify-center gap-2 rounded-md px-2.5 text-sm"
    >
      <span className={cn("size-2.5 rounded-full ring-3", meta.dot, meta.ring)} aria-hidden="true" />
      <span className="hidden sm:inline">{meta.lamp}</span>
    </Link>
  );
}

export function Header({ discordUsername, avatarUrl, onLogout, isSidebarOpen, showStatus = false, showMenuButton = true }: HeaderProps) {
  const [isUserSettingsOpen, setUserSettingsOpen] = useState(false);
  const userMenuTriggerRef = useRef<HTMLButtonElement>(null);
  return (
    <header className="bg-background z-30 flex h-14 shrink-0 items-center justify-between gap-2 border-b px-2 md:px-4">
      <div className="flex min-w-0 items-center gap-1">
        {showMenuButton && (
        <DialogTrigger asChild targetId={MOBILE_SIDEBAR_DIALOG_ID}>
          <Button
            variant="ghost"
            size="icon"
            className="size-11 shrink-0 md:hidden"
            aria-label="メニューを開閉"
            aria-expanded={isSidebarOpen}
          >
            <IconMenu2 className="size-5" />
          </Button>
        </DialogTrigger>
        )}
        {/* メニューボタンが無い画面のスマホ幅では左端に寄りすぎるため、PC幅(px-4)と同じ余白にそろえる。 */}
        <Link to="/" className={cn("truncate text-sm font-semibold hover:underline", !showMenuButton && "max-md:pl-2")}>
          Management Bot
        </Link>
      </div>
      <div className="flex min-w-0 items-center gap-1">
      {showStatus && <StatusLamp />}
      <Dropdown className="contents">
        <DropdownTrigger
          ref={userMenuTriggerRef}
          className="flex h-11 min-w-0 shrink-0 items-center gap-2 rounded-md px-2 text-sm hover:bg-accent"
          aria-label="ユーザーメニュー"
        >
          {avatarUrl ? (
            <img src={avatarUrl} alt="" className="size-7 shrink-0 rounded-full" />
          ) : (
            <span className="bg-muted flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold" aria-hidden="true">
              {discordUsername.slice(0, 1).toUpperCase()}
            </span>
          )}
          <span className="hidden max-w-40 truncate sm:inline">{discordUsername}</span>
          <IconChevronDown className="text-muted-foreground hidden size-4 sm:block" aria-hidden="true" />
        </DropdownTrigger>
        <DropdownContent align="end">
          <DropdownItem onClick={() => setUserSettingsOpen(true)}>ユーザー設定</DropdownItem>
          <DropdownSeparator />
          <DropdownItem onClick={onLogout}>ログアウト</DropdownItem>
        </DropdownContent>
      </Dropdown>
      <UserSettingsDialog open={isUserSettingsOpen} onOpenChange={setUserSettingsOpen} returnFocusRef={userMenuTriggerRef} />
      </div>
    </header>
  );
}
