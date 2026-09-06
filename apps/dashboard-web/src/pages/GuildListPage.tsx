import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
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
        管理できるサーバーが見つかりませんでした。Botがサーバーに導入されているか、管理者権限をお持ちかご確認ください。
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-lg font-semibold">サーバーを選択</h1>
      <ul className="flex flex-col gap-2">
        {guildsQuery.data.map((guild) => (
          <li key={guild.id}>
            <Button asChild variant="outline" className="w-full justify-start">
              <Link to={`/guilds/${guild.id}/logs`}>{guild.name}</Link>
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}
