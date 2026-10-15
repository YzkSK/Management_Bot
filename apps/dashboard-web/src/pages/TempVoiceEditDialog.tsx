import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AudioLines, Ban, Check, Crown, EyeOff, Lock, Pencil, Users, X } from "lucide-react";
import { toast } from "@/components/starwind/toast";
import { trpc } from "../trpc.js";
import {
  buildChannelEditActions,
  buildChannelEditDraft,
  describeSaveFailure,
  effectiveOverrides,
  overrideKey,
  SAVE_SUCCESS_MESSAGE,
  validateChannelEditDraft,
  type ChannelEditDraft,
  type ChannelEditInitial,
  type OverrideEntry,
  type OverrideState,
  type OverrideTargetType,
} from "./temp-voice-edit.js";
import { InlineError } from "@/components/page-state";
import { Button } from "@/components/starwind/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/starwind/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/starwind/select";
import { Switch } from "@/components/starwind/switch";

export interface EditableTempVoiceChannel extends ChannelEditInitial {
  channelId: string;
  ownerId: string;
  members: readonly { userId: string; name: string }[];
}

const FIELD_LABEL = "text-muted-foreground flex min-w-0 flex-col gap-1.5 text-sm";
const NO_TRANSFER = "none";
const FIRST_PAGE_KEY = "__first__";

/** メンバー候補はページングAPIなので、取得済みページをカーソル単位で保持して選択肢にする(AccessPageと同じ方針)。 */
function useTargetOptions(guildId: string, channelId: string) {
  const [after, setAfter] = useState<string | undefined>(undefined);
  const [pages, setPages] = useState<Record<string, readonly { id: string; name: string }[]>>({});
  const query = useQuery(trpc.tempVoice.listOverrideTargetOptions.queryOptions({ guildId, channelId, after }));
  useEffect(() => {
    if (query.data) setPages((prev) => ({ ...prev, [after ?? FIRST_PAGE_KEY]: query.data.members }));
  }, [after, query.data]);
  return {
    members: Object.values(pages).flat(),
    roles: query.data?.roles ?? [],
    isError: query.isError,
    nextAfter: query.data?.nextAfter,
    isFetching: query.isFetching,
    loadNextPage: () => setAfter(query.data?.nextAfter),
    retry: () => void query.refetch(),
  };
}

function OverrideChip({ entry, onRemove }: { entry: OverrideEntry; onRemove: () => void }) {
  const StateIcon = entry.state === "allow" ? Check : Ban;
  const label = entry.name ?? (entry.targetType === "user" ? "メンバー" : "ロール");
  return (
    <li className="bg-muted inline-flex items-center gap-1.5 rounded-full py-0.5 pr-1 pl-2.5 text-xs">
      <StateIcon className="size-3" aria-hidden />
      <span className="max-w-40 truncate">
        {entry.targetType === "role" ? "@" : ""}
        {label}
        <span className="sr-only">{entry.state === "allow" ? "(許可)" : "(拒否)"}</span>
      </span>
      <button type="button" aria-label={`${label}の設定を解除`} className="hover:bg-background rounded-full p-0.5" onClick={onRemove}>
        <X className="size-3" aria-hidden />
      </button>
    </li>
  );
}

function OverridesSection({
  guildId,
  channelId,
  draft,
  update,
}: {
  guildId: string;
  channelId: string;
  draft: ChannelEditDraft;
  update: (patch: Partial<ChannelEditDraft>) => void;
}) {
  const overridesQuery = useQuery(trpc.tempVoice.getChannelOverrides.queryOptions({ guildId, channelId }));
  const options = useTargetOptions(guildId, channelId);
  const [target, setTarget] = useState("");
  const [state, setState] = useState<OverrideState>("allow");

  const current: OverrideEntry[] = overridesQuery.data ?? [];
  const entries = effectiveOverrides(current, draft.pending);

  const setPending = (targetType: OverrideTargetType, targetId: string, name: string | undefined, change: OverrideState | "remove") =>
    update({ pending: { ...draft.pending, [overrideKey(targetType, targetId)]: { targetType, targetId, name, change } } });

  const add = () => {
    const [targetType, ...rest] = target.split(":");
    const targetId = rest.join(":");
    if ((targetType !== "user" && targetType !== "role") || targetId === "") return;
    const name = (targetType === "user" ? options.members : options.roles).find((o) => o.id === targetId)?.name;
    setPending(targetType, targetId, name, state);
    setTarget("");
  };

  return (
    <section className="flex flex-col gap-2" aria-label="個別許可・拒否">
      <h3 className="flex items-center gap-1.5 text-sm font-semibold">
        <Check className="size-4" aria-hidden />
        個別許可・拒否
      </h3>
      {overridesQuery.isError ? (
        <InlineError summary="現在の設定を読み込めませんでした。" onRetry={() => void overridesQuery.refetch()} />
      ) : entries.length === 0 ? (
        <p className="text-muted-foreground text-xs">個別に許可・拒否しているメンバー/ロールはありません。</p>
      ) : (
        <ul className="flex flex-wrap gap-1.5">
          {entries.map((entry) => (
            <OverrideChip
              key={overrideKey(entry.targetType, entry.targetId)}
              entry={entry}
              onRemove={() => setPending(entry.targetType, entry.targetId, entry.name, "remove")}
            />
          ))}
        </ul>
      )}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <label className={`${FIELD_LABEL} flex-1`}>
          追加するメンバー/ロール
          <Select value={target} onValueChange={setTarget}>
            <SelectTrigger className="w-full" aria-label="追加するメンバー/ロール">
              <SelectValue placeholder="選択してください" />
            </SelectTrigger>
            <SelectContent>
              {options.members.map((m) => (
                <SelectItem key={`user:${m.id}`} value={`user:${m.id}`}>
                  {m.name}
                </SelectItem>
              ))}
              {options.roles.map((r) => (
                <SelectItem key={`role:${r.id}`} value={`role:${r.id}`}>
                  @{r.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
        <Select value={state} onValueChange={(value) => setState(value === "deny" ? "deny" : "allow")}>
          <SelectTrigger className="w-full sm:w-28" aria-label="許可または拒否">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="allow">許可</SelectItem>
            <SelectItem value="deny">拒否</SelectItem>
          </SelectContent>
        </Select>
        <Button type="button" variant="outline" disabled={target === ""} onClick={add}>
          追加
        </Button>
      </div>
      {options.isError && <InlineError summary="候補の取得に失敗しました。" onRetry={options.retry} />}
      {options.nextAfter && (
        <Button type="button" variant="outline" size="sm" className="w-fit" disabled={options.isFetching} onClick={options.loadNextPage}>
          さらにメンバーを読み込む
        </Button>
      )}
    </section>
  );
}

export function EditForm({
  guildId,
  channel,
  onDone,
}: {
  guildId: string;
  channel: EditableTempVoiceChannel;
  onDone: () => void;
}) {
  const queryClient = useQueryClient();
  const updateChannel = useMutation(trpc.tempVoice.updateChannel.mutationOptions());
  const overridesQuery = useQuery(trpc.tempVoice.getChannelOverrides.queryOptions({ guildId, channelId: channel.channelId }));
  const [draft, setDraft] = useState<ChannelEditDraft>(() => buildChannelEditDraft(channel));
  const update = (patch: Partial<ChannelEditDraft>) => setDraft((prev) => ({ ...prev, ...patch }));
  // 項目を順に送るため、updateChannel.isPendingだけだと項目間でボタンが一瞬戻ってしまう。
  const [saving, setSaving] = useState(false);

  const errors = validateChannelEditDraft(draft, channel.name);
  const actions = buildChannelEditActions(channel, draft, overridesQuery.data ?? []);
  const transferCandidates = channel.members.filter((m) => m.userId !== channel.ownerId);

  const save = async () => {
    let applied = 0;
    setSaving(true);
    try {
      // 変更された項目だけを順に送る(オーナー移譲は最後)。updateChannelはbotの反映完了まで待つため、
      // 途中で失敗したらそこで止め、サーバーのエラーメッセージを出す。
      for (const action of actions) {
        await updateChannel.mutateAsync({ guildId, channelId: channel.channelId, action });
        applied++;
      }
      toast.success(SAVE_SUCCESS_MESSAGE);
      onDone();
    } catch (error) {
      const { message, description } = describeSaveFailure(error, applied);
      toast.error(message, description === undefined ? undefined : { description });
    } finally {
      setSaving(false);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: trpc.tempVoice.listActiveChannels.queryOptions({ guildId }).queryKey }),
        queryClient.invalidateQueries({
          queryKey: trpc.tempVoice.getChannelOverrides.queryOptions({ guildId, channelId: channel.channelId }).queryKey,
        }),
      ]);
    }
  };

  return (
    <>
      <div className="flex max-h-[60vh] flex-col gap-4 overflow-y-auto py-1">
        <label className={FIELD_LABEL} htmlFor="temp-voice-edit-name">
          <span className="flex items-center gap-1.5">
            <Pencil className="size-4" aria-hidden />
            チャンネル名
          </span>
          <Input id="temp-voice-edit-name" value={draft.name} onChange={(e) => update({ name: e.target.value })} />
          <span className="text-xs">名前の変更は10分に2回までです。</span>
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className={FIELD_LABEL} htmlFor="temp-voice-edit-limit">
            <span className="flex items-center gap-1.5">
              <Users className="size-4" aria-hidden />
              人数制限(0で無制限)
            </span>
            <Input
              id="temp-voice-edit-limit"
              type="number"
              min={0}
              max={99}
              value={draft.userLimit}
              onChange={(e) => update({ userLimit: e.target.value })}
            />
          </label>
          <label className={FIELD_LABEL} htmlFor="temp-voice-edit-bitrate">
            <span className="flex items-center gap-1.5">
              <AudioLines className="size-4" aria-hidden />
              音質(kbps)
            </span>
            <Input id="temp-voice-edit-bitrate" value={draft.bitrateKbps} onChange={(e) => update({ bitrateKbps: e.target.value })} />
          </label>
        </div>
        <div className="flex items-center justify-between gap-3 text-sm">
          <label htmlFor="temp-voice-edit-locked" className="flex items-center gap-1.5">
            <Lock className="size-4" aria-hidden />
            ロック(新規入室を禁止)
          </label>
          <Switch id="temp-voice-edit-locked" checked={draft.locked} onCheckedChange={(locked) => update({ locked })} />
        </div>
        <div className="flex items-center justify-between gap-3 text-sm">
          <label htmlFor="temp-voice-edit-hidden" className="flex items-center gap-1.5">
            <EyeOff className="size-4" aria-hidden />
            非表示
          </label>
          <Switch id="temp-voice-edit-hidden" checked={draft.hidden} onCheckedChange={(hidden) => update({ hidden })} />
        </div>

        <OverridesSection guildId={guildId} channelId={channel.channelId} draft={draft} update={update} />

        <label className={FIELD_LABEL}>
          <span className="flex items-center gap-1.5">
            <Crown className="size-4" aria-hidden />
            オーナー移譲(在室メンバーから選択)
          </span>
          <Select value={draft.transferTo === "" ? NO_TRANSFER : draft.transferTo} onValueChange={(v) => update({ transferTo: v === NO_TRANSFER ? "" : v })}>
            <SelectTrigger className="w-full" aria-label="オーナー移譲先">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NO_TRANSFER}>移譲しない</SelectItem>
              {transferCandidates.map((m) => (
                <SelectItem key={m.userId} value={m.userId}>
                  {m.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {draft.transferTo !== "" && <span className="text-xs">保存すると、あなたはこのVCのオーナーではなくなります。</span>}
        </label>

        {errors.length > 0 && (
          <ul className="text-destructive flex flex-col gap-1 text-sm">
            {errors.map((error) => (
              <li key={error}>{error}</li>
            ))}
          </ul>
        )}
      </div>
      <DialogFooter>
        <DialogClose asChild>
          <Button variant="outline">キャンセル</Button>
        </DialogClose>
        <Button type="button" disabled={errors.length > 0 || actions.length === 0 || saving} onClick={() => void save()}>
          {saving ? "反映中…" : "保存"}
        </Button>
      </DialogFooter>
    </>
  );
}

/** 一時VCカード下部の「設定を変更」ボタンと、設定変更ダイアログ(オーナー本人/MANAGE_TEMP_VOICE向け)。 */
export function EditChannelButton({ guildId, channel }: { guildId: string; channel: EditableTempVoiceChannel }) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Pencil className="size-3.5" aria-hidden />
          設定を変更
        </Button>
      </DialogTrigger>
      <DialogContent className="top-1/2 left-1/2 w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 rounded-xl border p-6">
        <DialogHeader>
          <DialogTitle>{channel.name || "一時VC"}の設定を変更</DialogTitle>
          <DialogDescription>変更した項目だけがDiscordに反映されます。反映が終わるまで少しお待ちください。</DialogDescription>
        </DialogHeader>
        <EditForm guildId={guildId} channel={channel} onDone={() => setOpen(false)} />
      </DialogContent>
    </Dialog>
  );
}
