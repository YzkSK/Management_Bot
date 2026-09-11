import { useState } from "react";
import { Link } from "react-router-dom";
import { getStoredTheme, setTheme, type Theme } from "./theme.js";
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
}

const THEME_OPTIONS: readonly { value: Theme; label: string }[] = [
  { value: "light", label: "ライト" },
  { value: "dark", label: "ダーク" },
  { value: "system", label: "システムに合わせる" },
];

export function Header({ discordUsername, avatarUrl, onLogout }: HeaderProps) {
  const [theme, setThemeState] = useState<Theme>(() => getStoredTheme());

  return (
    <header className="flex items-center justify-between border-b px-4 py-3">
      <Link to="/" className="text-sm font-semibold hover:underline">
        Management Bot Dashboard
      </Link>
      <DropdownMenu>
        <DropdownMenuTrigger className="flex items-center gap-2 rounded-md p-1 text-sm hover:bg-accent">
          {avatarUrl && <img src={avatarUrl} alt="" className="size-7 rounded-full" />}
          <span>{discordUsername}</span>
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
