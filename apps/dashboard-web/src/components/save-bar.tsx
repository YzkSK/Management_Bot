import { TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * 未保存の変更がある間だけ画面下部に出す保存バー。編集は即時保存せず、ここから明示的に保存する。
 * 保存結果はバーではなくトースト(sonner)で知らせる。
 */
export function SaveBar({
  dirty,
  saving,
  onSave,
  onDiscard,
}: {
  dirty: boolean;
  saving: boolean;
  onSave: () => void;
  onDiscard: () => void;
}) {
  if (!dirty) return null;
  return (
    <div
      role="region"
      aria-label="未保存の変更"
      className="bg-foreground text-background sticky bottom-4 z-20 mt-2 flex items-center gap-3 rounded-xl px-4 py-2.5 shadow-lg"
    >
      <TriangleAlert className="text-warning size-4 shrink-0" aria-hidden="true" />
      <span className="min-w-0 flex-1 text-sm">保存されていない変更があります</span>
      <Button
        type="button"
        variant="outline"
        className="border-muted-foreground/40 bg-transparent text-background hover:bg-background/10 hover:text-background"
        disabled={saving}
        onClick={onDiscard}
      >
        変更を破棄
      </Button>
      <Button type="button" className="bg-background text-foreground hover:bg-background/90" disabled={saving} onClick={onSave}>
        {saving ? "保存中..." : "保存"}
      </Button>
    </div>
  );
}
