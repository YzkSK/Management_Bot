import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { inferOutput } from "@trpc/tanstack-react-query";
import { IconDeviceDesktop, IconHeadphonesOff, IconMicrophoneOff, IconVideo, IconVolume, type TablerIcon } from "@tabler/icons-react";
import { trpc } from "../trpc.js";
import { cn } from "@/lib/utils";
import { formatDuration } from "./activity-range.js";
import { ErrorState } from "@/components/page-state";
import { Loading } from "@/components/loading";

type ActiveVoiceChannel = inferOutput<typeof trpc.activity.activeVoice>[number];

/** 自分でのミュート/デフはグレー、サーバー(管理者)によるものはエラー色で区別する。 */
function MuteIcon({ self, server, label, Icon }: { self: boolean; server: boolean; label: string; Icon: TablerIcon }) {
  if (!self && !server) return null;
  return (
    <Icon
      aria-label={server ? `サーバー${label}` : label}
      className={cn("size-4", server ? "text-error" : "text-muted-foreground")}
    />
  );
}

/** 小さなラベル(人数・AFK・一時VC・オーナー)。縦中央・折り返しなし。 */
const BADGE =
  "bg-muted text-muted-foreground inline-flex h-6 shrink-0 items-center rounded-sm px-2 text-xs leading-none font-semibold whitespace-nowrap";

interface VoiceMember {
  name: string;
  avatarUrl: string | null;
  selfMute: boolean;
  serverMute: boolean;
  selfDeaf: boolean;
  serverDeaf: boolean;
  streaming: boolean;
  video: boolean;
}

/** アクティブVCと一時VC一覧で共通のメンバー行(アバター・名前・画面共有/カメラ/ミュートのアイコン)。 */
export function VoiceMemberRow({ member: m, dimmed = false, badge }: { member: VoiceMember; dimmed?: boolean; badge?: string }) {
  return (
    <li className={cn("flex items-center gap-2.5 rounded-md px-2 py-1.5", dimmed && "opacity-50")}>
      {m.avatarUrl ? (
        <img src={m.avatarUrl} alt="" className="size-7 shrink-0 rounded-full" />
      ) : (
        <span className="bg-muted size-7 shrink-0 rounded-full" />
      )}
      <span className="min-w-0 truncate text-sm">{m.name}</span>
      {badge && <span className={BADGE}>{badge}</span>}
      <span className="flex flex-1 items-center justify-end gap-1.5">
        {m.streaming && <IconDeviceDesktop aria-label="画面共有中" className="text-muted-foreground size-4" />}
        {m.video && <IconVideo aria-label="カメラON" className="text-muted-foreground size-4" />}
        <MuteIcon self={m.selfMute} server={m.serverMute} label="ミュート" Icon={IconMicrophoneOff} />
        <MuteIcon self={m.selfDeaf} server={m.serverDeaf} label="スピーカーミュート" Icon={IconHeadphonesOff} />
      </span>
    </li>
  );
}

export function ActiveVoiceView({
  channels,
  now,
  tempVoiceChannelIds = new Set(),
}: {
  channels: readonly ActiveVoiceChannel[];
  now: Date;
  /** 一時VCのchannelId。該当チャンネルに「一時VC」バッジを付ける。 */
  tempVoiceChannelIds?: ReadonlySet<string>;
}) {
  if (channels.length === 0) {
    return <p className="text-muted-foreground rounded-lg border border-dashed p-8 text-center text-sm">現在VCにいるメンバーはいません。</p>;
  }
  const total = channels.reduce((sum, c) => sum + c.members.length, 0);
  return (
    <div className="flex flex-col gap-4">
      <p className="text-muted-foreground text-sm">
        VC <b className="text-foreground font-mono">{channels.length}</b> チャンネル ・ 在室 <b className="text-foreground font-mono">{total}</b> 人
      </p>
      <div className="grid items-start gap-3 md:grid-cols-2">
        {channels.map((channel) => (
          <section key={channel.channelId} className="bg-card flex flex-col gap-3 rounded-lg border p-4">
            <div className="flex items-center justify-between gap-2">
              <div className="flex min-w-0 items-center gap-2">
                <IconVolume className="text-muted-foreground size-4 shrink-0" aria-hidden />
                <span className="truncate text-sm font-semibold">{channel.channelName}</span>
                <span className={BADGE}>{channel.members.length}人</span>
                {channel.afk && <span className={BADGE}>AFK</span>}
                {tempVoiceChannelIds.has(channel.channelId) && <span className={BADGE}>一時VC</span>}
              </div>
              <span className="text-muted-foreground text-xs whitespace-nowrap">
                継続{" "}
                <b className="text-foreground font-mono text-sm">
                  {formatDuration(Math.max(0, (now.getTime() - new Date(channel.startedAt).getTime()) / 1000))}
                </b>
              </span>
            </div>
            <ul className="flex flex-col gap-1">
              {channel.members.map((m) => (
                <VoiceMemberRow key={m.userId} member={m} dimmed={!m.counting} />
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
  // 一時VCかどうかの判定用。バッジは補助表示なので、取得できなくてもアクティブVC自体は表示する。
  // VIEW_TEMP_VOICEが無ければAPIは自分がオーナーのVCしか返さないため、他人の一時VCにはバッジが付かない。
  // Redis由来でWSの無効化対象外のため、一時VCページと同じく10秒ごとに再取得する(後から作られた一時VCにもバッジを付ける)。
  const tempVoiceQuery = useQuery({ ...trpc.tempVoice.listActiveChannels.queryOptions({ guildId }), refetchInterval: 10_000 });
  if (query.isPending) return <Loading />;
  if (query.isError) return <ErrorState subject="アクティブVC" onRetry={() => void query.refetch()} />;
  const tempVoiceChannelIds = new Set(tempVoiceQuery.data?.map((c) => c.channelId));
  return <ActiveVoiceView channels={query.data} now={now} tempVoiceChannelIds={tempVoiceChannelIds} />;
}
