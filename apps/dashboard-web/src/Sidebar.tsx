import { useQuery } from "@tanstack/react-query";
import { FEATURE_METADATA } from "@management-bot/shared";
import { NavLink, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { NO_ACCESS_MESSAGE } from "./no-access-message.js";
import { trpc } from "./trpc.js";
import { cn } from "@/lib/utils";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

/** ページ実装済みの機能のみここに登録する(未実装の機能はリンクにしない)。 */
const FEATURE_PATHS: Record<string, (guildId: string) => string> = {
  logging: (guildId) => `/guilds/${guildId}/logs`,
};

interface SidebarProps {
  guildId?: string;
  /** モバイル幅でのドロワー開閉状態。デスクトップ幅(md以上)では常に表示するため参照しない。 */
  open?: boolean;
}

function SidebarNav({ guildId, guilds, navigate }: { guildId?: string; guilds: readonly { id: string; name: string }[]; navigate: (path: string) => void }) {
  return (
    <>
      <div className="mb-3">
        <Select
          value={guildId ?? ""}
          onValueChange={(value) => {
            const guild = guilds.find((g) => g.id === value);
            if (!guild?.canViewLogs) {
              toast.error(NO_ACCESS_MESSAGE);
              return;
            }
            navigate(`/guilds/${value}/logs`);
          }}
          disabled={guilds.length === 0}
        >
          <SelectTrigger className="w-full" aria-label="サーバーを選択">
            <SelectValue placeholder="サーバーを選択" />
          </SelectTrigger>
          <SelectContent>
            {guilds.map((guild) => (
              <SelectItem
                key={guild.id}
                value={guild.id}
                className={!guild.canViewLogs ? "text-muted-foreground opacity-50" : undefined}
              >
                {guild.name}
                {!guild.canViewLogs && "(権限なし)"}
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
        <li>
          {guildId ? (
            <NavLink
              to={`/guilds/${guildId}/access`}
              className={({ isActive }) =>
                cn(
                  "block rounded-md px-3 py-2 text-sm hover:bg-accent hover:text-accent-foreground",
                  isActive && "bg-accent text-accent-foreground font-medium",
                )
              }
            >
              アクセス権限
            </NavLink>
          ) : (
            <span className="text-muted-foreground block px-3 py-2 text-sm">アクセス権限</span>
          )}
        </li>
      </ul>
    </>
  );
}

export function Sidebar({ guildId, open = false }: SidebarProps) {
  const navigate = useNavigate();
  const guildsQuery = useQuery(trpc.guildSettings.listMyGuilds.queryOptions());
  const guilds = guildsQuery.data ?? [];

  return (
    <>
      {/* デスクトップ幅では常設。モバイルドロワー(下記)と二重表示にならないようhiddenで隠す。 */}
      <nav aria-label="機能メニュー" className="hidden border-r p-2 md:block md:w-56 md:shrink-0">
        <SidebarNav guildId={guildId} guilds={guilds} navigate={navigate} />
      </nav>
      {/*
        モバイルドロワーはopen時のみDOMに描画する。CSSのtranslateで隠すだけだと、閉じていても
        Tabキーでリンク/セレクトへフォーカスが移動できてしまうため(codexレビュー対応)。
      */}
      {open && (
        <nav
          id="mobile-sidebar"
          aria-label="機能メニュー"
          className="bg-background fixed top-14 bottom-0 left-0 z-40 w-64 overflow-y-auto border-r p-2 md:hidden"
        >
          <SidebarNav guildId={guildId} guilds={guilds} navigate={navigate} />
        </nav>
      )}
    </>
  );
}
