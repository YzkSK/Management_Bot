import { useEffect, useState } from "react";
import { Menu } from "lucide-react";
import { Link } from "react-router-dom";
import { getStoredTheme, setTheme, watchSystemTheme, type Theme } from "./theme.js";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface HeaderProps {
  discordUsername: string;
  avatarUrl: string | null;
  onLogout: () => void;
  onToggleSidebar: () => void;
}

const THEME_OPTIONS: readonly { value: Theme; label: string }[] = [
  { value: "light", label: "ライト" },
  { value: "dark", label: "ダーク" },
  { value: "system", label: "システムに合わせる" },
];

export function Header({ discordUsername, avatarUrl, onLogout, onToggleSidebar }: HeaderProps) {
  const [theme, setThemeState] = useState<Theme>(() => getStoredTheme());

  useEffect(() => watchSystemTheme(theme), [theme]);

  return (
    <header className="bg-background sticky top-0 z-50 flex items-center justify-between border-b px-4 py-3">
      <div className="flex min-w-0 items-center gap-2">
        <Button variant="ghost" size="icon" className="shrink-0 md:hidden" onClick={onToggleSidebar} aria-label="メニューを開閉">
          <Menu className="size-5" />
        </Button>
        <Link to="/" className="truncate text-sm font-semibold hover:underline">
          Management Bot Dashboard
        </Link>
      </div>
      <DropdownMenu>
        <DropdownMenuTrigger className="flex min-w-0 shrink-0 items-center gap-2 rounded-md p-1 text-sm hover:bg-accent">
          {avatarUrl && <img src={avatarUrl} alt="" className="size-7 shrink-0 rounded-full" />}
          <span className="max-w-20 truncate sm:max-w-none">{discordUsername}</span>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuLabel>テーマ</DropdownMenuLabel>
          {THEME_OPTIONS.map((option) => (
            <DropdownMenuItem
              key={option.value}
              onSelect={() => {
                setTheme(option.value);
                setThemeState(option.value);
              }}
              className={option.value === theme ? "font-medium" : undefined}
            >
              {option.label}
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={onLogout}>ログアウト</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </header>
  );
}
