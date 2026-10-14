import { useQuery } from "@tanstack/react-query";
import { Bot, CircleAlert, Lock } from "lucide-react";
import type { ReactNode } from "react";
import type { CapabilityName } from "@management-bot/shared";
import { CAPABILITY_LABELS } from "../pages/capability-labels.js";
import { trpc } from "../trpc.js";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// 文節の途中で折り返さず(auto-phrase)、行の長さを揃える(balance)。文の区切りは<br>で明示する。
const WRAP = "[word-break:auto-phrase] [text-wrap:balance]";

type Tone = "warning" | "destructive" | "muted";

const TONE_CLASS: Record<Tone, string> = {
  warning: "bg-warning/15 text-warning",
  destructive: "bg-destructive/12 text-destructive",
  muted: "bg-muted text-muted-foreground",
};

function StateCard({ tone, icon, title, children }: { tone: Tone; icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <div role="alert" className="bg-card flex flex-col items-center gap-2.5 rounded-xl border px-6 py-12 text-center">
      <div className={cn("grid size-11 place-items-center rounded-full [&_svg]:size-5", TONE_CLASS[tone])}>{icon}</div>
      <h2 className={cn("text-base font-semibold", WRAP)}>{title}</h2>
      {children}
    </div>
  );
}

function Text({ children, small }: { children: ReactNode; small?: boolean }) {
  return <p className={cn("text-muted-foreground max-w-[34rem]", small && "text-xs", WRAP)}>{children}</p>;
}

function Pills({ labels }: { labels: readonly string[] }) {
  return (
    <div className="flex flex-wrap justify-center gap-1.5">
      {labels.map((label) => (
        <span key={label} className="bg-muted rounded-md px-1.5 font-semibold whitespace-nowrap">
          {label}
        </span>
      ))}
    </div>
  );
}

/** 権限がないとき、ページ本体の代わりに出す。必要な権限名はcapabilityのラベルから出す。 */
export function ForbiddenState({ pageName, capabilities }: { pageName: string; capabilities: readonly CapabilityName[] }) {
  return (
    <StateCard tone="warning" icon={<Lock aria-hidden="true" />} title="このページを見る権限がありません">
      <Text>{pageName}を見るには次の権限が必要です。</Text>
      <Pills labels={capabilities.map((name) => CAPABILITY_LABELS[name])} />
      <Text>サーバーの管理者に付与を依頼してください。</Text>
    </StateCard>
  );
}

/** 権限以外の取得失敗。再読み込みで失敗したクエリを取り直す。 */
export function ErrorState({ subject, onRetry }: { subject: string; onRetry: () => void }) {
  return (
    <StateCard tone="destructive" icon={<CircleAlert aria-hidden="true" />} title={`${subject}を読み込めませんでした`}>
      <Text>
        通信またはサーバーの一時的な問題の可能性があります。
        <br />
        時間をおいて再度お試しください。
      </Text>
      <div className="mt-1.5">
        <Button type="button" onClick={onRetry}>
          再読み込み
        </Button>
      </div>
    </StateCard>
  );
}

/** Discordの「サーバー管理」権限を持つ閲覧者か(Botの再認可を承認できる人か)。 */
function useCanReauthorize(guildId: string): boolean {
  const guildsQuery = useQuery(trpc.guildSettings.listMyGuilds.queryOptions());
  return guildsQuery.data?.find((guild) => guild.id === guildId)?.isManaged ?? false;
}

/** Botの権限不足(Discord側)。サーバー管理者にだけ再認可ボタンを出す。 */
export function BotPermissionState({
  guildId,
  permissions,
  reauthorizeUrl,
}: {
  guildId: string;
  /**
   * 足りないBot権限の表示名。Discord APIが403を返しただけで、どの権限が足りないか特定できない場合は省略する
   * (推測の権限名を案内しないため)。
   */
  permissions?: readonly string[];
  reauthorizeUrl?: string | null | undefined;
}) {
  const canReauthorize = useCanReauthorize(guildId);
  const known = permissions !== undefined && permissions.length > 0;
  return (
    <StateCard tone="muted" icon={<Bot aria-hidden="true" />} title="Botの権限が足りません">
      {known ? (
        <>
          <Text>Botに次の権限がないため、この情報を取得できません。</Text>
          <Pills labels={permissions} />
        </>
      ) : (
        <Text>Botに必要な権限がないため、この情報を取得できません。</Text>
      )}
      {canReauthorize && reauthorizeUrl ? (
        <>
          <div className="mt-1.5">
            <Button asChild>
              <a href={reauthorizeUrl} target="_blank" rel="noreferrer">
                Botを再認可する
              </a>
            </Button>
          </div>
          <Text small>
            ボタンから開くDiscordの画面で承認すると、Botに足りない権限が追加されます。
            <br />
            特定のチャンネルだけで起きる場合は、そのチャンネルの権限設定で
            <br />
            Botが拒否されていないか確認してください。
          </Text>
        </>
      ) : (
        <>
          <Text>
            {known ? "サーバーの管理者に、Botへこれらの権限を付与するよう依頼してください。" : "サーバーの管理者に、Botの権限を確認するよう依頼してください。"}
          </Text>
          <Text small>
            特定のチャンネルだけで起きる場合は、
            <br />
            そのチャンネルの権限設定でBotが拒否されている可能性があります。
          </Text>
        </>
      )}
    </StateCard>
  );
}

/** Botがサーバーに未参加。 */
/** 自分が参加していない(またはBotが導入されていない)サーバーのページを開いたとき。 */
export function NotMemberState() {
  return (
    <StateCard tone="warning" icon={<Lock aria-hidden="true" />} title="このサーバーのページは開けません">
      <Text>
        このサーバーに参加していないか、Botが導入されていません。
        <br />
        サーバー一覧から開き直してください。
      </Text>
    </StateCard>
  );
}

export function BotNotJoinedState() {
  return (
    <StateCard tone="muted" icon={<Bot aria-hidden="true" />} title="Botがこのサーバーに参加していません">
      <Text>
        Botをサーバーに招待すると、この情報を取得できるようになります。
        <br />
        サーバーの管理者に招待を依頼してください。
      </Text>
    </StateCard>
  );
}

/** ページの一部(補助情報)だけ失敗したときの帯。主データの表示は止めない。 */
export function InlineError({ summary, detail, onRetry }: { summary: string; detail?: string; onRetry: () => void }) {
  return (
    <div
      role="alert"
      className="border-destructive/35 bg-destructive/8 flex items-start gap-2.5 rounded-[10px] border px-3.5 py-2.5 text-sm"
    >
      <CircleAlert className="text-destructive mt-0.5 size-4 shrink-0" aria-hidden="true" />
      <p className="min-w-0 flex-1">
        <b>{summary}</b>
        {detail && ` ${detail}`}{" "}
        <button type="button" className="underline" onClick={onRetry}>
          再読み込み
        </button>
      </p>
    </div>
  );
}
