import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { inferOutput } from "@trpc/tanstack-react-query";
import { HeadphoneOff, type LucideIcon, MicOff, Monitor, Video, Volume2 } from "lucide-react";
import { trpc } from "../trpc.js";
import { cn } from "@/lib/utils";
import { formatDuration } from "./activity-range.js";
import { Loading } from "@/components/ui/skeleton";

type ActiveVoiceChannel = inferOutput<typeof trpc.activity.activeVoice>[number];

/** 自分でのミュート/デフはグレー、サーバー(管理者)によるものは赤で区別する。 */
function MuteIcon({ self, server, label, Icon }: { self: boolean; server: boolean; label: string; Icon: LucideIcon }) {
  if (!self && !server) return null;
  return (
    <Icon
      aria-label={server ? `サーバー${label}` : label}
      className={cn("size-4", server ? "text-red-600" : "text-muted-foreground")}
    />
  );
}

export function ActiveVoiceView({ channels, now }: { channels: readonly ActiveVoiceChannel[]; now: Date }) {
  if (channels.length === 0) {
    return <p className="text-muted-foreground rounded-md border p-8 text-center text-sm">現在VCにいるメンバーはいません。</p>;
  }
  const total = channels.reduce((sum, c) => sum + c.members.length, 0);
  return (
    <div className="flex flex-col gap-4">
      <p className="text-muted-foreground text-sm">
        VC <b className="text-foreground">{channels.length}</b> チャンネル ・ 在室 <b className="text-foreground">{total}</b> 人
      </p>
      <div className="grid items-start gap-3 md:grid-cols-2">
        {channels.map((channel) => (
          <section key={channel.channelId} className="flex flex-col gap-3 rounded-lg border p-4">
            <div className="flex items-center justify-between gap-2">
              <div className="flex min-w-0 items-center gap-2">
                <Volume2 className="text-muted-foreground size-4 shrink-0" aria-hidden />
                <span className="truncate text-sm font-semibold">{channel.channelName}</span>
                <span className="bg-muted text-muted-foreground rounded-full px-2 py-0.5 text-xs">{channel.members.length}人</span>
                {channel.afk && <span className="bg-muted text-muted-foreground rounded-full px-2 py-0.5 text-xs">AFK</span>}
              </div>
              <span className="text-muted-foreground text-xs whitespace-nowrap">
                継続{" "}
                <b className="text-foreground text-sm">
                  {formatDuration(Math.max(0, (now.getTime() - new Date(channel.startedAt).getTime()) / 1000))}
                </b>
              </span>
            </div>
            <ul className="flex flex-col gap-1">
              {channel.members.map((m) => (
                <li key={m.userId} className={cn("flex items-center gap-2.5 rounded-md px-2 py-1.5", !m.counting && "opacity-50")}>
                  {m.avatarUrl ? (
                    <img src={m.avatarUrl} alt="" className="size-7 shrink-0 rounded-full" />
                  ) : (
                    <span className="bg-muted size-7 shrink-0 rounded-full" />
                  )}
                  <span className="min-w-0 flex-1 truncate text-sm">{m.name}</span>
                  <span className="flex items-center gap-1.5">
                    {m.streaming && <Monitor aria-label="画面共有中" className="size-4 text-violet-600" />}
                    {m.video && <Video aria-label="カメラON" className="size-4 text-blue-600" />}
                    <MuteIcon self={m.selfMute} server={m.serverMute} label="ミュート" Icon={MicOff} />
                    <MuteIcon self={m.selfDeaf} server={m.serverDeaf} label="スピーカーミュート" Icon={HeadphoneOff} />
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}

export function ActiveVoiceTab({ guildId, now }: { guildId: string; now: Date }) {
  const query = useQuery({
    ...trpc.activity.activeVoice.queryOptions({ guildId }),
    placeholderData: keepPreviousData,
  });
  if (query.isPending) return <Loading />;
  if (query.isError) return <p className="text-destructive text-sm">アクティブVCの取得に失敗しました。</p>;
  return <ActiveVoiceView channels={query.data} now={now} />;
}
