import { useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { hasCapability } from "@management-bot/shared";
import { NavLink, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import type { ManagedGuildWithAccess } from "@management-bot/dashboard-api";
import { GuildIcon } from "./guild-icon.js";
import { firstAccessiblePath, GUILD_PAGES, guildPagePath, type GuildPage } from "./guild-pages.js";
import { NO_ACCESS_MESSAGE } from "./no-access-message.js";
import { trpc } from "./trpc.js";
import { cn } from "@/lib/utils";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DialogContent, DialogTitle } from "@/components/ui/dialog";

interface SidebarProps {
  guildId?: string;
  /** モバイル幅でのドロワー開閉状態。デスクトップ幅(md以上)では常に表示するため参照しない。 */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

function PageSection({
  title,
  pages,
  guildId,
  onNavigate,
  className,
}: {
  title: string;
  pages: readonly GuildPage[];
  guildId?: string;
  onNavigate?: () => void;
  className: string;
}) {
  if (pages.length === 0) return null;
  return (
    <>
      <p className={cn("text-muted-foreground px-3 pb-1 text-xs font-semibold", className)}>{title}</p>
      <ul className="flex flex-col gap-0.5">
        {pages.map((page) => (
          <li key={page.key}>
            {guildId ? (
              <NavLink
                to={guildPagePath(guildId, page)}
                onClick={onNavigate}
                className={({ isActive }) =>
                  cn(
                    "flex min-h-10 items-center rounded-md px-3 text-sm hover:bg-accent hover:text-accent-foreground",
                    isActive && "bg-accent text-accent-foreground font-medium",
                  )
                }
              >
                {page.name}
              </NavLink>
            ) : (
              <span className="text-muted-foreground flex min-h-10 items-center px-3 text-sm">{page.name}</span>
            )}
          </li>
        ))}
      </ul>
    </>
  );
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
  // サーバー選択中は閲覧権限のあるページだけを出す(issue #527)。未選択時は全項目を非リンクで出す。
  const currentGuild = guilds.find((g) => g.id === guildId);
  const visiblePages = currentGuild
    ? GUILD_PAGES.filter((page) => hasCapability(currentGuild.capabilities, page.capability))
    : GUILD_PAGES;
  const featurePages = visiblePages.filter((page) => page.key !== "access");
  const adminPages = visiblePages.filter((page) => page.key === "access");

  return (
    <>
      <div className="mb-3">
        <Select
          value={guildId ?? ""}
          onValueChange={(value) => {
            const guild = guilds.find((g) => g.id === value);
            const path = guild ? firstAccessiblePath(guild.id, guild.capabilities) : null;
            if (!path) {
              toast.error(NO_ACCESS_MESSAGE);
              return;
            }
            navigate(path);
          }}
          onOpenChange={(selectOpen) => {
            if (selectOpen) {
              pickedGuildRef.current = null;
              return;
            }
            if (pickedGuildRef.current && firstAccessiblePath(pickedGuildRef.current.id, pickedGuildRef.current.capabilities)) {
              onNavigate?.();
            }
          }}
          disabled={guilds.length === 0}
        >
          <SelectTrigger className="h-12 w-full" aria-label="サーバーを選択">
            <SelectValue placeholder="サーバーを選択" />
          </SelectTrigger>
          <SelectContent>
            {guilds.map((guild) => (
              <SelectItem
                key={guild.id}
                value={guild.id}
                className={!firstAccessiblePath(guild.id, guild.capabilities) ? "text-muted-foreground opacity-50" : undefined}
                onPointerUp={() => {
                  pickedGuildRef.current = guild;
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") pickedGuildRef.current = guild;
                }}
              >
                <span className="flex min-w-0 items-center gap-2">
                  <GuildIcon name={guild.name} iconUrl={guild.iconUrl} className="size-7 rounded-lg text-xs" />
                  <span className="truncate">
                    {guild.name}
                    {!firstAccessiblePath(guild.id, guild.capabilities) && "(権限なし)"}
                  </span>
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <PageSection title="機能" pages={featurePages} guildId={guildId} onNavigate={onNavigate} className="pt-2" />
      <PageSection title="管理" pages={adminPages} guildId={guildId} onNavigate={onNavigate} className="pt-4" />
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
