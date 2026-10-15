import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { X } from "lucide-react";
import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { toast } from "@/components/starwind/toast";
import { roleMentionLabel } from "@management-bot/shared";
import { isForbiddenError } from "../dashboard-query-client.js";
import { trpc } from "../trpc.js";
import {
  buildScheduledPostSettingsDraft,
  hasScheduledPostSettingsChanges,
  toUpdateSettingsInput,
  type ScheduledPostSettingsDraft,
} from "./scheduled-post-settings-draft.js";
import { ErrorState, ForbiddenState } from "@/components/page-state";
import { SaveBar } from "@/components/save-bar";
import { Alert, AlertDescription } from "@/components/starwind/alert";
import { Loading } from "@/components/loading";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/starwind/select";
import { Switch } from "@/components/starwind/switch";

export function ScheduledPostSettingsPage() {
  const { guildId } = useParams<{ guildId: string }>();
  const queryClient = useQueryClient();
  const [draftState, setDraftState] = useState<ScheduledPostSettingsDraft | null>(null);
  const [saving, setSaving] = useState(false);

  const settingsQuery = useQuery({
    ...trpc.scheduledPost.getSettings.queryOptions({ guildId: guildId ?? "" }),
    enabled: Boolean(guildId),
  });
  const roleOptionsQuery = useQuery({
    ...trpc.scheduledPost.listRoleOptions.queryOptions({ guildId: guildId ?? "" }),
    enabled: Boolean(guildId),
  });
  const updateSettings = useMutation(trpc.scheduledPost.updateSettings.mutationOptions());

  if (!guildId) {
    return (
      <Alert variant="error">
        <AlertDescription>サーバーが指定されていません。</AlertDescription>
      </Alert>
    );
  }

  const queries = [settingsQuery, roleOptionsQuery];
  if (queries.some((query) => isForbiddenError(query.error))) {
    return <ForbiddenState pageName="予約投稿の設定" capabilities={["MANAGE_SCHEDULED_POSTS"]} />;
  }
  const failedQueries = queries.filter((query) => query.isError);
  const isPending = queries.some((query) => query.isPending);
  const isError = failedQueries.length > 0;

  const server = settingsQuery.data ?? null;
  const roleOptions = roleOptionsQuery.data ?? null;
  const draft = server ? (draftState ?? buildScheduledPostSettingsDraft(server)) : null;
  const dirty = server && draft ? hasScheduledPostSettingsChanges(server, draft) : false;

  const updateDraft = (update: (current: ScheduledPostSettingsDraft) => ScheduledPostSettingsDraft) => {
    if (draft) setDraftState(update(draft));
  };

  const save = async () => {
    if (!draft || !dirty) return;
    setSaving(true);
    try {
      await updateSettings.mutateAsync(toUpdateSettingsInput(guildId, draft));
      toast.success("保存しました");
      setDraftState(null);
    } catch {
      toast.error("保存に失敗しました。時間をおいて再度お試しください。");
    } finally {
      setSaving(false);
      await queryClient.invalidateQueries({ queryKey: trpc.scheduledPost.getSettings.queryOptions({ guildId }).queryKey });
    }
  };

  const roleNameById = new Map((roleOptions ?? []).map((role) => [role.id, role.name]));
  const addableRoles = (roleOptions ?? []).filter((role) => !draft?.roleIds.includes(role.id));

  return (
    <div className="flex flex-col gap-4">
      <Link to={`/guilds/${guildId}/scheduled-post`} className="w-fit text-sm hover:underline">
        ← 予約投稿へ戻る
      </Link>
      <h1 className="text-2xl font-bold">予約投稿の設定</h1>

      {isPending && !isError && <Loading />}
      {isError && <ErrorState subject="予約投稿の設定" onRetry={() => failedQueries.forEach((query) => void query.refetch())} />}

      {draft && roleOptions && (
        <>
          <section className="bg-card flex flex-col gap-3 rounded-xl border p-5">
            <h2 className="font-bold">使えるロール</h2>
            <p className="text-muted-foreground text-sm">
              選んだロールを持つメンバーだけが予約投稿を使えます。1つも選ばない場合はメンバー全員が使えます。
            </p>
            <div className="flex flex-wrap items-center gap-2">
              {draft.roleIds.length === 0 && <span className="text-muted-foreground text-sm">メンバー全員が使えます</span>}
              {draft.roleIds.map((roleId) => {
                const name = roleMentionLabel(roleNameById.get(roleId) ?? roleId);
                return (
                  <span key={roleId} className="bg-card flex h-8 items-center gap-1.5 rounded-full border pr-1 pl-3 text-xs">
                    {name}
                    <button
                      type="button"
                      aria-label={`${name}を外す`}
                      className="text-muted-foreground hover:text-foreground flex size-6 items-center justify-center rounded-full"
                      onClick={() => updateDraft((current) => ({ ...current, roleIds: current.roleIds.filter((id) => id !== roleId) }))}
                    >
                      <X className="size-3.5" aria-hidden="true" />
                    </button>
                  </span>
                );
              })}
              {addableRoles.length > 0 && (
                <Select
                  value=""
                  onValueChange={(roleId) => updateDraft((current) => ({ ...current, roleIds: [...current.roleIds, roleId] }))}
                >
                  <SelectTrigger className="w-48" aria-label="ロールを追加">
                    <SelectValue placeholder="+ ロールを追加" />
                  </SelectTrigger>
                  <SelectContent>
                    {addableRoles.map((role) => (
                      <SelectItem key={role.id} value={role.id}>
                        {role.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
          </section>

          <section className="bg-card flex flex-col gap-3 rounded-xl border p-5">
            <h2 className="font-bold">メンション</h2>
            <label className="flex items-center gap-2 text-sm">
              <Switch
                checked={draft.allowEveryone}
                aria-label="予約時に @everyone を指定できるようにする"
                onCheckedChange={(checked) => updateDraft((current) => ({ ...current, allowEveryone: checked }))}
              />
              予約時に @everyone を指定できるようにする
            </label>
            <label className="flex items-center gap-2 text-sm">
              <Switch
                checked={draft.allowHere}
                aria-label="予約時に @here を指定できるようにする"
                onCheckedChange={(checked) => updateDraft((current) => ({ ...current, allowHere: checked }))}
              />
              予約時に @here を指定できるようにする
            </label>
            <p className="text-muted-foreground text-xs">
              予約者に「@everyone、@here、すべてのロールにメンション」権限がある場合のみ有効です。
            </p>
          </section>

          <SaveBar dirty={dirty} saving={saving} onSave={() => void save()} onDiscard={() => setDraftState(null)} />
        </>
      )}
    </div>
  );
}
