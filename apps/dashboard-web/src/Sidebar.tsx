import { useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { FEATURE_METADATA } from "@management-bot/shared";
import { NavLink, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import type { ManagedGuildWithAccess } from "@management-bot/dashboard-api";
import { NO_ACCESS_MESSAGE } from "./no-access-message.js";
import { trpc } from "./trpc.js";
import { cn } from "@/lib/utils";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DialogContent, DialogTitle } from "@/components/ui/dialog";

/** ページ実装済みの機能のみここに登録する(未実装の機能はリンクにしない)。 */
const FEATURE_PATHS: Record<string, (guildId: string) => string> = {
  logging: (guildId) => `/guilds/${guildId}/logs`,
};

interface SidebarProps {
  guildId?: string;
  /** モバイル幅でのドロワー開閉状態。デスクトップ幅(md以上)では常に表示するため参照しない。 */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

function SidebarNav({
  guildId,
  guilds,
  navigate,
  onNavigate,
}: {
  guildId?: string;
  guilds: readonly ManagedGuildWithAccess[];
  navigate: (path: string) => void;
  /** リンク/セレクトでの遷移後に呼ばれる(モバイルドロワーを閉じるため)。 */
  onNavigate?: () => void;
}) {
  // クリック/キー確定されたguild(Escや選択肢外クリックでのキャンセルではnull)。
  // 同一guildの再選択時はRadix SelectPrimitiveのonValueChangeが発火しないため、
  // SelectItem側で直接どのguildが押されたかを記録する。
  const pickedGuildRef = useRef<ManagedGuildWithAccess | null>(null);

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
          onOpenChange={(selectOpen) => {
            if (selectOpen) {
              pickedGuildRef.current = null;
              return;
            }
            if (pickedGuildRef.current?.canViewLogs) onNavigate?.();
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
                onPointerUp={() => {
                  pickedGuildRef.current = guild;
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") pickedGuildRef.current = guild;
                }}
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
                  onClick={onNavigate}
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
              onClick={onNavigate}
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

export function Sidebar({ guildId, open = false, onOpenChange }: SidebarProps) {
  const navigate = useNavigate();
  const guildsQuery = useQuery(trpc.guildSettings.listMyGuilds.queryOptions());
  const guilds = guildsQuery.data ?? [];
  const closeMobileDrawer = () => onOpenChange?.(false);

  return (
    <>
      {/* デスクトップ幅では常設。モバイルドロワー(Dialog)と二重表示にならないようhiddenで隠す。 */}
      <nav
        aria-label="機能メニュー"
        className="hidden overflow-y-auto border-r p-2 md:block md:w-56 md:shrink-0"
      >
        <SidebarNav guildId={guildId} guilds={guilds} navigate={navigate} />
      </nav>
      {/*
        モバイルドロワーはRadix Dialogでモーダル化する(Tab循環・背景inert・
        閉じた後のトリガーへのフォーカス復帰をDialogに任せる。codexレビュー対応)。
      */}
      {open && (
        <DialogContent
          className="top-14 left-0 h-[calc(100dvh-3.5rem)] w-64 translate-x-0 translate-y-0 overflow-y-auto border-r p-2 md:hidden"
          aria-label="機能メニュー"
        >
          <DialogTitle className="sr-only">機能メニュー</DialogTitle>
          <SidebarNav guildId={guildId} guilds={guilds} navigate={navigate} onNavigate={closeMobileDrawer} />
        </DialogContent>
      )}
    </>
  );
}
