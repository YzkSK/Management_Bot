import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import type { ManagedGuildWithAccess } from "@management-bot/dashboard-api";
import { GuildIcon } from "../guild-icon.js";
import { NO_ACCESS_MESSAGE } from "../no-access-message.js";
import { trpc } from "../trpc.js";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Input } from "@/components/ui/input";
import { Loading } from "@/components/ui/skeleton";

const CARD = "bg-card flex w-full items-center gap-3.5 rounded-xl border p-4 text-left";

function GuildInitial({ guild }: { guild: ManagedGuildWithAccess }) {
  return <GuildIcon name={guild.name} iconUrl={guild.iconUrl} className="size-12 rounded-2xl text-lg" />;
}

function GuildCard({ guild }: { guild: ManagedGuildWithAccess }) {
  if (!guild.canViewActivity) {
    return (
      <button
        type="button"
        aria-describedby={`guild-access-note-${guild.id}`}
        className={`${CARD} text-muted-foreground opacity-50`}
        onClick={() => toast.error(NO_ACCESS_MESSAGE)}
      >
        <GuildInitial guild={guild} />
        <span className="flex min-w-0 flex-col gap-1">
          <span className="truncate font-medium">{guild.name}</span>
          <span id={`guild-access-note-${guild.id}`} className="text-xs">
            アクセス権限がありません
          </span>
        </span>
      </button>
    );
  }
  return (
    <Link to={`/guilds/${guild.id}/activity`} className={`${CARD} hover:bg-accent/50`}>
      <GuildInitial guild={guild} />
      <span className="flex min-w-0 flex-col gap-1">
        <span className="truncate font-medium">{guild.name}</span>
        <span
          className="text-muted-foreground text-xs"
          title={
            guild.isManaged
              ? undefined
              : "Discord上でオーナーまたは「サーバー管理」権限がないため、閲覧権限のある機能のみ利用できます。"
          }
        >
          {guild.isManaged ? "管理者" : "閲覧のみ(管理者権限がありません)"}
        </span>
      </span>
    </Link>
  );
}

export function GuildListPage() {
  const guildsQuery = useQuery(trpc.guildSettings.listMyGuilds.queryOptions());
  const [keyword, setKeyword] = useState("");

  if (guildsQuery.isPending) {
    return <Loading />;
  }

  if (guildsQuery.isError) {
    return (
      <Alert variant="destructive">
        <AlertDescription>サーバー一覧の取得に失敗しました。時間をおいて再度お試しください。</AlertDescription>
      </Alert>
    );
  }

  if (guildsQuery.data.length === 0) {
    return (
      <p className="text-muted-foreground rounded-xl border border-dashed p-10 text-center text-sm">
        表示できるサーバーが見つかりませんでした。Botがサーバーに導入されているかご確認ください。
      </p>
    );
  }

  const normalized = keyword.trim().toLowerCase();
  const guilds = normalized === "" ? guildsQuery.data : guildsQuery.data.filter((g) => g.name.toLowerCase().includes(normalized));

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-bold">サーバーを選択</h1>
          <p className="text-muted-foreground text-sm">Botが導入されていて、あなたが所属しているサーバーです。</p>
        </div>
        <label className="text-muted-foreground flex w-full flex-col gap-1.5 text-sm sm:w-64">
          サーバー名で絞り込み
          <Input type="search" placeholder="検索" value={keyword} onChange={(e) => setKeyword(e.target.value)} />
        </label>
      </div>
      {guilds.length === 0 ? (
        <p className="text-muted-foreground text-sm">「{keyword}」に一致するサーバーはありません。</p>
      ) : (
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {guilds.map((guild) => (
            <li key={guild.id}>
              <GuildCard guild={guild} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
