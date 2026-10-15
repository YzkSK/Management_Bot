import { DISCORD_PERMISSION_LABELS } from "@management-bot/shared";
import { IconChevronDown, IconFilter, IconX } from "@tabler/icons-react";
import { useState } from "react";
import { permissionIcon } from "./permission-icons.js";
import { EMPTY_ROLE_FILTER, type RoleFilterValue } from "./role-filter.js";
import { Checkbox } from "@/components/starwind/checkbox";
import { Button } from "@/components/starwind/button";
import { Input } from "@/components/starwind/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/starwind/popover";

interface ActiveChip {
  key: string;
  label: string;
  clear: Partial<RoleFilterValue>;
}

function activeChips(value: RoleFilterValue): ActiveChip[] {
  const chips: ActiveChip[] = [];
  for (const { key, label } of DISCORD_PERMISSION_LABELS) {
    if (!value.permissionKeys.includes(key)) continue;
    chips.push({
      key: `permission-${key}`,
      label: `権限: ${label}`,
      clear: { permissionKeys: value.permissionKeys.filter((k) => k !== key) },
    });
  }
  if (value.minMembers.trim() !== "" || value.maxMembers.trim() !== "") {
    chips.push({
      key: "members",
      label: `人数: ${value.minMembers.trim() || "…"}〜${value.maxMembers.trim() || "…"}人`,
      clear: { minMembers: "", maxMembers: "" },
    });
  }
  return chips;
}

/** ロール一覧の絞り込み。AuditLogFilterと同じく、ボタンから開くパネルに条件を集約し、適用中の条件はチップで示す。 */
export function RoleFilter({
  value,
  onChange,
  memberCountsAvailable,
}: {
  value: RoleFilterValue;
  onChange: (next: RoleFilterValue) => void;
  /** メンバー数を取得できたか。できない場合は人数の条件を出さない。 */
  memberCountsAvailable: boolean;
}) {
  const [open, setOpen] = useState(false);

  const chips = activeChips(value);
  const patch = (next: Partial<RoleFilterValue>) => onChange({ ...value, ...next });
  const togglePermission = (key: string, checked: boolean) =>
    patch({ permissionKeys: checked ? [...value.permissionKeys, key] : value.permissionKeys.filter((k) => k !== key) });

  return (
    <Popover open={open} onOpenChange={setOpen} className="flex flex-wrap items-center gap-2">
      <PopoverTrigger asChild>
        <Button type="button" variant="outline">
          <IconFilter aria-hidden="true" />
          絞り込み: <b>{chips.length === 0 ? "すべて" : `${chips.length}件`}</b>
          <IconChevronDown className="text-muted-foreground" aria-hidden="true" />
        </Button>
      </PopoverTrigger>
      {chips.map((chip) => (
        <span key={chip.key} className="bg-card flex h-8 items-center gap-1.5 rounded-full border pr-1 pl-3 text-xs">
          {chip.label}
          <button
            type="button"
            aria-label={`${chip.label}を解除`}
            className="text-muted-foreground hover:text-foreground flex size-6 items-center justify-center rounded-full"
            onClick={() => patch(chip.clear)}
          >
            <IconX className="size-3.5" aria-hidden="true" />
          </button>
        </span>
      ))}
      {chips.length > 0 && (
        <button
          type="button"
          className="text-muted-foreground px-1 text-xs underline"
          onClick={() => onChange(EMPTY_ROLE_FILTER)}
        >
          すべてクリア
        </button>
      )}
      <PopoverContent
        role="dialog"
        aria-label="ロールの絞り込み"
        align="start"
        sideOffset={8}
        className="w-[min(36rem,calc(100vw-2rem))] gap-3 rounded-xl p-3 shadow-lg"
      >
          {memberCountsAvailable && (
            <div className="grid grid-cols-[repeat(auto-fit,minmax(9.5rem,1fr))] gap-2.5">
              <label className="text-muted-foreground flex flex-col gap-1 text-xs">
                メンバー数(下限)
                <Input
                  type="number"
                  min={0}
                  inputMode="numeric"
                  className="text-foreground"
                  value={value.minMembers}
                  onChange={(e) => patch({ minMembers: e.target.value })}
                />
              </label>
              <label className="text-muted-foreground flex flex-col gap-1 text-xs">
                メンバー数(上限)
                <Input
                  type="number"
                  min={0}
                  inputMode="numeric"
                  className="text-foreground"
                  value={value.maxMembers}
                  onChange={(e) => patch({ maxMembers: e.target.value })}
                />
              </label>
            </div>
          )}
          <fieldset className="flex min-w-0 flex-col gap-1">
            <legend className="text-muted-foreground mb-1 text-xs">持っている権限(選んだものをすべて持つロール)</legend>
            <div className="grid max-h-64 grid-cols-[repeat(auto-fit,minmax(14rem,1fr))] gap-x-2 overflow-y-auto">
              {DISCORD_PERMISSION_LABELS.map(({ key, label }) => {
                const Icon = permissionIcon(key);
                return (
                  <label key={key} className="hover:bg-accent/60 flex min-h-9 cursor-pointer items-center gap-2 rounded-md px-1.5 text-sm">
                    <Checkbox
                      aria-label={label}
                      className="shrink-0"
                      checked={value.permissionKeys.includes(key)}
                      onCheckedChange={(checked) => togglePermission(key, checked)}
                    />
                    <Icon className="text-muted-foreground size-4 shrink-0" aria-hidden="true" />
                    <span className="min-w-0 break-words">{label}</span>
                  </label>
                );
              })}
            </div>
          </fieldset>
          <div className="flex justify-between border-t pt-2.5">
            <Button type="button" variant="ghost" size="sm" onClick={() => onChange(EMPTY_ROLE_FILTER)}>
              すべて解除
            </Button>
            <Button type="button" size="sm" onClick={() => setOpen(false)}>
              閉じる
            </Button>
          </div>
      </PopoverContent>
    </Popover>
  );
}
