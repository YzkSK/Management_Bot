import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { NO_ACCESS_MESSAGE } from "../no-access-message.js";
import { trpc } from "../trpc.js";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

export function GuildListPage() {
  const guildsQuery = useQuery(trpc.guildSettings.listMyGuilds.queryOptions());

  if (guildsQuery.isPending) {
    return <div className="text-sm">読み込み中...</div>;
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
      <p className="text-muted-foreground text-sm">
        表示できるサーバーが見つかりませんでした。Botがサーバーに導入されているかご確認ください。
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-lg font-semibold">サーバーを選択</h1>
      <ul className="flex flex-col gap-2">
        {guildsQuery.data.map((guild) =>
          guild.canViewLogs ? (
            <li key={guild.id}>
              <Button asChild variant="outline" className="w-full justify-start">
                <Link to={`/guilds/${guild.id}/logs`}>
                  {guild.name}
                  {!guild.isManaged && (
                    <span
                      className="ml-auto text-xs text-muted-foreground"
                      title="Discord上でオーナーまたは「サーバー管理」権限がないため、閲覧権限のある機能のみ利用できます。"
                    >
                      管理者権限がありません
                    </span>
                  )}
                </Link>
              </Button>
            </li>
          ) : (
            <li key={guild.id}>
              <Button
                type="button"
                variant="outline"
                aria-disabled="true"
                className="w-full justify-start text-muted-foreground opacity-50"
                onClick={() => toast.error(NO_ACCESS_MESSAGE)}
              >
                {guild.name}
                <span className="ml-auto text-xs">アクセス権限がありません</span>
              </Button>
            </li>
          ),
        )}
      </ul>
    </div>
  );
}
