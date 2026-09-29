import * as React from "react";
import { cn } from "@/lib/utils";

function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="skeleton" className={cn("bg-accent animate-pulse rounded-md", className)} {...props} />;
}

/** 読み込み中の領域。スクリーンリーダー向けに「読み込み中」を残し、見た目はchildren(省略時は行のスケルトン)で表す。 */
function Loading({ className, rows = 3, children }: { className?: string; rows?: number; children?: React.ReactNode }) {
  return (
    <div role="status" aria-busy="true" className={cn("flex flex-col gap-2", className)}>
      <span className="sr-only">読み込み中</span>
      {children ?? Array.from({ length: rows }, (_, i) => <Skeleton key={i} className="h-9 w-full" />)}
    </div>
  );
}

export { Loading, Skeleton };
