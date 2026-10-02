import { ChevronDown, ListFilter, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { LogCategory } from "@management-bot/shared";
import { CATEGORY_ACCENT, CATEGORY_ICON, CATEGORY_OPTIONS } from "./category-labels.js";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

function CategoryMark({ category }: { category: LogCategory }) {
  const Icon = CATEGORY_ICON[category];
  const color = CATEGORY_ACCENT[category];
  return (
    <>
      <span className="h-3.5 w-[3px] shrink-0 rounded-full" style={{ backgroundColor: color }} aria-hidden="true" />
      <Icon className="size-3.5 shrink-0" style={{ color }} aria-hidden="true" />
    </>
  );
}

/** ログのカテゴリ複数選択。カテゴリ数が多いため横並びにせず、ボタンから開く一覧で選ぶ。 */
export function CategoryFilter({
  selected,
  onChange,
}: {
  selected: readonly LogCategory[];
  onChange: (next: LogCategory[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [keyword, setKeyword] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (rootRef.current && e.target instanceof Node && !rootRef.current.contains(e.target)) setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const toggle = (category: LogCategory) =>
    onChange(selected.includes(category) ? selected.filter((c) => c !== category) : [...selected, category]);
  const normalized = keyword.trim();
  const options = normalized === "" ? CATEGORY_OPTIONS : CATEGORY_OPTIONS.filter((o) => o.label.includes(normalized));

  return (
    <div ref={rootRef} className="relative flex flex-wrap items-center gap-2">
      <Button type="button" variant="outline" aria-haspopup="true" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <ListFilter aria-hidden="true" />
        カテゴリ: <b>{selected.length === 0 ? "すべて" : `${selected.length}件選択中`}</b>
        <ChevronDown className="text-muted-foreground" aria-hidden="true" />
      </Button>
      {selected.map((category) => (
        <span key={category} className="bg-card flex h-8 items-center gap-1.5 rounded-full border pr-1 pl-3 text-xs">
          <CategoryMark category={category} />
          {CATEGORY_OPTIONS.find((o) => o.value === category)?.label}
          <button
            type="button"
            aria-label={`${CATEGORY_OPTIONS.find((o) => o.value === category)?.label}を解除`}
            className="text-muted-foreground hover:text-foreground flex size-6 items-center justify-center rounded-full"
            onClick={() => toggle(category)}
          >
            <X className="size-3.5" aria-hidden="true" />
          </button>
        </span>
      ))}
      {selected.length > 0 && (
        <button type="button" className="text-muted-foreground px-1 text-xs underline" onClick={() => onChange([])}>
          すべてクリア
        </button>
      )}
      {open && (
        <div
          role="dialog"
          aria-label="カテゴリで絞り込み"
          className="bg-popover absolute top-11 left-0 z-30 flex w-[min(36rem,calc(100vw-2rem))] flex-col gap-2.5 rounded-xl border p-3 shadow-lg"
        >
          <Input
            type="search"
            aria-label="カテゴリを検索"
            placeholder="カテゴリを検索"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
          />
          <div className="grid grid-cols-1 gap-x-2 gap-y-0.5 sm:grid-cols-2 md:grid-cols-3">
            {options.map((option) => (
              <label
                key={option.value}
                className="hover:bg-accent/60 has-checked:bg-accent flex min-h-9 cursor-pointer items-center gap-2 rounded-md px-1.5 text-sm"
              >
                <input
                  type="checkbox"
                  className="accent-foreground size-4"
                  checked={selected.includes(option.value)}
                  onChange={() => toggle(option.value)}
                />
                <CategoryMark category={option.value} />
                {option.label}
              </label>
            ))}
          </div>
          <div className="flex justify-between border-t pt-2.5">
            <Button type="button" variant="ghost" size="sm" onClick={() => onChange([])}>
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
