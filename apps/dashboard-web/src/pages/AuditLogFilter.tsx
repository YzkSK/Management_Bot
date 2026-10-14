import { ChevronDown, ListFilter, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { AUDIT_PERIOD_LABELS, AUDIT_PERIODS, auditFeatureLabel, type AuditPeriod } from "./audit-log-labels.js";
import { Checkbox } from "@/components/starwind/checkbox";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export interface AuditFilterValue {
  /** 空文字=絞り込まない(Radix Selectは空文字をvalueにできないため、Selectにはこの値をALLへ変換して渡す)。 */
  actorId: string;
  feature: string;
  period: AuditPeriod;
  fromDate: string;
  toDate: string;
  onlyIssues: boolean;
  hideAccess: boolean;
}

export const EMPTY_AUDIT_FILTER: AuditFilterValue = {
  actorId: "",
  feature: "",
  period: "all",
  fromDate: "",
  toDate: "",
  onlyIssues: false,
  hideAccess: false,
};

const ALL = "__all__";

interface ActiveChip {
  key: string;
  label: string;
  clear: Partial<AuditFilterValue>;
}

function activeChips(
  value: AuditFilterValue,
  actors: readonly { id: string; name: string }[],
): ActiveChip[] {
  const chips: ActiveChip[] = [];
  if (value.actorId !== "") {
    const name = actors.find((a) => a.id === value.actorId)?.name ?? value.actorId;
    chips.push({ key: "actor", label: `操作者: ${name}`, clear: { actorId: "" } });
  }
  if (value.feature !== "") {
    chips.push({ key: "feature", label: `機能: ${auditFeatureLabel(value.feature)}`, clear: { feature: "" } });
  }
  if (value.period === "custom") {
    if (value.fromDate !== "" || value.toDate !== "") {
      chips.push({
        key: "period",
        label: `期間: ${value.fromDate || "…"} 〜 ${value.toDate || "…"}`,
        clear: { period: "all", fromDate: "", toDate: "" },
      });
    }
  } else if (value.period !== "all") {
    chips.push({ key: "period", label: `期間: ${AUDIT_PERIOD_LABELS[value.period]}`, clear: { period: "all" } });
  }
  if (value.onlyIssues) chips.push({ key: "issues", label: "失敗・権限不足のみ", clear: { onlyIssues: false } });
  if (value.hideAccess) chips.push({ key: "access", label: "アクセス履歴を隠す", clear: { hideAccess: false } });
  return chips;
}

/** 操作履歴の絞り込み。CategoryFilterと同じく、ボタンから開くパネルに条件を集約し、適用中の条件はチップで示す。 */
export function AuditLogFilter({
  value,
  onChange,
  actors,
  features,
}: {
  value: AuditFilterValue;
  onChange: (next: AuditFilterValue) => void;
  actors: readonly { id: string; name: string }[];
  features: readonly string[];
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!(e.target instanceof Element)) return;
      // セレクターの選択肢はportalでパネルの外に描画されるため、外側クリック扱いにしない。
      if (rootRef.current?.contains(e.target) || e.target.closest("[data-radix-popper-content-wrapper]")) return;
      setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      // 開いているセレクターのEscはセレクター側だけを閉じる。
      if (e.key === "Escape" && !document.querySelector('[role="listbox"]')) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const chips = activeChips(value, actors);
  const patch = (next: Partial<AuditFilterValue>) => onChange({ ...value, ...next });

  return (
    <div ref={rootRef} className="relative flex flex-wrap items-center gap-2">
      <Button type="button" variant="outline" aria-haspopup="true" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <ListFilter aria-hidden="true" />
        絞り込み: <b>{chips.length === 0 ? "すべて" : `${chips.length}件`}</b>
        <ChevronDown className="text-muted-foreground" aria-hidden="true" />
      </Button>
      {chips.map((chip) => (
        <span key={chip.key} className="bg-card flex h-8 items-center gap-1.5 rounded-full border pr-1 pl-3 text-xs">
          {chip.label}
          <button
            type="button"
            aria-label={`${chip.label}を解除`}
            className="text-muted-foreground hover:text-foreground flex size-6 items-center justify-center rounded-full"
            onClick={() => patch(chip.clear)}
          >
            <X className="size-3.5" aria-hidden="true" />
          </button>
        </span>
      ))}
      {chips.length > 0 && (
        <button
          type="button"
          className="text-muted-foreground px-1 text-xs underline"
          onClick={() => onChange(EMPTY_AUDIT_FILTER)}
        >
          すべてクリア
        </button>
      )}
      {open && (
        <div
          role="dialog"
          aria-label="操作履歴の絞り込み"
          className="bg-popover absolute top-11 left-0 z-30 flex w-[min(36rem,calc(100vw-2rem))] flex-col gap-3 rounded-xl border p-3 shadow-lg"
        >
          <div className="grid grid-cols-[repeat(auto-fit,minmax(9.5rem,1fr))] gap-2.5">
            <label className="text-muted-foreground flex flex-col gap-1 text-xs">
              操作者
              <Select value={value.actorId === "" ? ALL : value.actorId} onValueChange={(v) => patch({ actorId: v === ALL ? "" : v })}>
                <SelectTrigger className="text-foreground w-full" aria-label="操作者">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>すべて</SelectItem>
                  {actors.map((actor) => (
                    <SelectItem key={actor.id} value={actor.id}>
                      {actor.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
            <label className="text-muted-foreground flex flex-col gap-1 text-xs">
              機能
              <Select value={value.feature === "" ? ALL : value.feature} onValueChange={(v) => patch({ feature: v === ALL ? "" : v })}>
                <SelectTrigger className="text-foreground w-full" aria-label="機能">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>すべて</SelectItem>
                  {features.map((f) => (
                    <SelectItem key={f} value={f}>
                      {auditFeatureLabel(f)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
            <label className="text-muted-foreground flex flex-col gap-1 text-xs">
              期間
              <Select
                value={value.period}
                onValueChange={(v) => {
                  const period = AUDIT_PERIODS.find((p) => p === v);
                  if (period) patch({ period, ...(period === "custom" ? {} : { fromDate: "", toDate: "" }) });
                }}
              >
                <SelectTrigger className="text-foreground w-full" aria-label="期間">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {AUDIT_PERIODS.map((p) => (
                    <SelectItem key={p} value={p}>
                      {AUDIT_PERIOD_LABELS[p]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
            {value.period === "custom" && (
              <div className="col-span-full grid grid-cols-2 gap-2.5">
                <label className="text-muted-foreground flex flex-col gap-1 text-xs">
                  開始日
                  <Input type="date" className="text-foreground" value={value.fromDate} onChange={(e) => patch({ fromDate: e.target.value })} />
                </label>
                <label className="text-muted-foreground flex flex-col gap-1 text-xs">
                  終了日
                  <Input type="date" className="text-foreground" value={value.toDate} onChange={(e) => patch({ toDate: e.target.value })} />
                </label>
              </div>
            )}
          </div>
          <div className="flex flex-col gap-0.5">
            <label className="hover:bg-accent/60 flex min-h-9 cursor-pointer items-center gap-2 rounded-md px-1.5 text-sm">
              <Checkbox
                aria-label="失敗・権限不足のみ表示する"
                checked={value.onlyIssues}
                onCheckedChange={(checked) => patch({ onlyIssues: checked })}
              />
              失敗・権限不足のみ表示する
            </label>
            <label className="hover:bg-accent/60 flex min-h-9 cursor-pointer items-center gap-2 rounded-md px-1.5 text-sm">
              <Checkbox
                aria-label="アクセス履歴を隠す"
                checked={value.hideAccess}
                onCheckedChange={(checked) => patch({ hideAccess: checked })}
              />
              アクセス履歴を隠す
            </label>
          </div>
          <div className="flex justify-between border-t pt-2.5">
            <Button type="button" variant="ghost" size="sm" onClick={() => onChange(EMPTY_AUDIT_FILTER)}>
              すべて解除
            </Button>
            <Button type="button" size="sm" onClick={() => setOpen(false)}>
              閉じる
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
