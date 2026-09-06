import { useQuery } from "@tanstack/react-query";
import { FEATURE_METADATA } from "@management-bot/shared";
import { NavLink, useNavigate } from "react-router-dom";
import { trpc } from "./trpc.js";
import { cn } from "@/lib/utils";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

/** ページ実装済みの機能のみここに登録する(未実装の機能はリンクにしない)。 */
const FEATURE_PATHS: Record<string, (guildId: string) => string> = {
  logging: (guildId) => `/guilds/${guildId}/logs`,
};

interface SidebarProps {
  guildId?: string;
}

export function Sidebar({ guildId }: SidebarProps) {
  const navigate = useNavigate();
  const guildsQuery = useQuery(trpc.guildSettings.listMyGuilds.queryOptions());
  const guilds = guildsQuery.data ?? [];

  return (
    <nav aria-label="機能メニュー" className="w-56 shrink-0 border-r p-2">
      <div className="mb-3">
        <Select value={guildId ?? ""} onValueChange={(value) => navigate(`/guilds/${value}/logs`)} disabled={guilds.length === 0}>
          <SelectTrigger className="w-full" aria-label="サーバーを選択">
            <SelectValue placeholder="サーバーを選択" />
          </SelectTrigger>
          <SelectContent>
            {guilds.map((guild) => (
              <SelectItem key={guild.id} value={guild.id}>
                {guild.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <ul className="flex flex-col gap-1">
        {FEATURE_METADATA.map((feature) => {
          const buildPath = FEATURE_PATHS[feature.key];
          const path = guildId && buildPath ? buildPath(guildId) : undefined;
          return (
            <li key={feature.key}>
              {path ? (
                <NavLink
                  to={path}
                  className={({ isActive }) =>
                    cn(
                      "block rounded-md px-3 py-2 text-sm hover:bg-accent hover:text-accent-foreground",
                      isActive && "bg-accent text-accent-foreground font-medium",
                    )
                  }
                >
                  {feature.name}
                </NavLink>
              ) : (
                <span className="text-muted-foreground block px-3 py-2 text-sm">{feature.name}</span>
              )}
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
