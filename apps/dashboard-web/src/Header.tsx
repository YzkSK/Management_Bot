import { ChevronDown, Menu } from "lucide-react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { DialogTrigger } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface HeaderProps {
  discordUsername: string;
  avatarUrl: string | null;
  onLogout: () => void;
  isSidebarOpen: boolean;
}

export function Header({ discordUsername, avatarUrl, onLogout, isSidebarOpen }: HeaderProps) {
  return (
    <header className="bg-background z-30 flex h-14 shrink-0 items-center justify-between gap-2 border-b px-2 md:px-4">
      <div className="flex min-w-0 items-center gap-1">
        <DialogTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="size-11 shrink-0 md:hidden"
            aria-label="メニューを開閉"
            aria-expanded={isSidebarOpen}
          >
            <Menu className="size-5" />
          </Button>
        </DialogTrigger>
        <Link to="/" className="truncate text-sm font-semibold hover:underline">
          Management Bot Dashboard
        </Link>
      </div>
      <DropdownMenu>
        <DropdownMenuTrigger
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
          <ChevronDown className="text-muted-foreground hidden size-4 sm:block" aria-hidden="true" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem asChild>
            <Link to="/settings">ユーザー設定</Link>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={onLogout}>ログアウト</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </header>
  );
}
