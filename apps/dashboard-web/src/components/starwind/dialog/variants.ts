import { tv } from "tailwind-variants";

// 移行前のRadix版Dialogと同じ見た目に固定している。
// <dialog>のUAスタイル(余白・幅・inset・枠・背景色)は打ち消し、位置と大きさは呼び出し側のclassで決める。
export const dialogBackdrop = tv({
  base: [
    "fixed inset-0 z-40 bg-black/50",
    "data-starting-style:!animate-none data-starting-style:opacity-0",
    "data-[state=open]:animate-in data-[state=open]:fade-in-0",
    "data-[state=closed]:animate-out data-[state=closed]:fill-mode-forwards data-[state=closed]:fade-out-0",
  ],
});

export const dialogContent = tv({
  base: [
    "bg-background text-foreground fixed inset-auto z-50 m-0 h-auto max-h-none w-auto max-w-none overflow-visible border-0 p-0 outline-hidden backdrop:bg-transparent",
    "data-starting-style:!animate-none data-starting-style:opacity-0",
    "data-[state=open]:animate-in data-[state=open]:slide-in-from-left",
    "data-[state=closed]:animate-out data-[state=closed]:fill-mode-forwards data-[state=closed]:slide-out-to-left",
  ],
});

export const dialogDescription = tv({
  base: "text-muted-foreground text-sm",
});

export const dialogFooter = tv({
  base: "flex justify-end gap-2",
});

export const dialogHeader = tv({
  base: "flex flex-col gap-2",
});

export const dialogTitle = tv({
  base: "text-sm font-semibold",
});
