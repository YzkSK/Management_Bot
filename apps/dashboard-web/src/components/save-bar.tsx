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
    <>
    {/* 固定バーで末尾のコンテンツが隠れないよう、同じ高さの余白を確保する */}
    <div className="h-16" aria-hidden="true" />
    {/* メイン領域(サイドバーを除く)の下端に固定する。md:left-56はサイドバー幅、bottom-12はフッターの上。 */}
    <div className="pointer-events-none fixed inset-x-0 bottom-12 z-20 flex justify-center px-4 md:left-56 md:px-8">
    <div
      role="region"
      aria-label="未保存の変更"
      className="bg-foreground text-background animate-save-bar-in pointer-events-auto flex w-full max-w-4xl items-center gap-3 rounded-xl px-4 py-2.5 shadow-lg"
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
    </div>
    </>
  );
}
