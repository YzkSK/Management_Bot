import type * as React from "react";
import { IconLoader2 } from "@tabler/icons-react";
import { cn } from "@/lib/utils";

/** 読み込み中の領域。childrenを渡せば実レイアウト同形のスケルトン、省略時はスピナーを出す。 */
export function Loading({ className, children }: { className?: string; children?: React.ReactNode }) {
  if (children) {
    return (
      <div role="status" aria-busy="true" className={cn("flex flex-col gap-2", className)}>
        <span className="sr-only">読み込み中</span>
        {children}
      </div>
    );
  }
  return (
    <div
      role="status"
      aria-busy="true"
      className={cn("text-muted-foreground flex items-center justify-center gap-2 py-8 text-sm", className)}
    >
      <IconLoader2 className="size-4 animate-spin" aria-hidden="true" />
      読み込み中
    </div>
  );
}
