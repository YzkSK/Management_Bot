import { tv } from "tailwind-variants";

// 移行前のRadix版Selectと同じ見た目に固定している。
// Rootは実DOMを持たないRadixに合わせてdisplay: contentsにし、レイアウトへ影響させない。
export const select = tv({
  base: "contents",
});

export const selectContent = tv({
  base: [
    "bg-popover text-popover-foreground z-50 min-w-[max(8rem,var(--anchor-width))] overflow-hidden rounded-md border shadow-md",
    "data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 outline-none",
    "data-[state=closed]:animate-out data-[state=closed]:fill-mode-forwards data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95",
    "data-[side=bottom]:slide-in-from-top-2 data-[side=top]:slide-in-from-bottom-2",
    "data-[side=right]:slide-in-from-left-2 data-[side=left]:slide-in-from-right-2",
    "data-[align-trigger=true]:!animate-none",
    "origin-(--transform-origin) pointer-events-auto fixed isolate will-change-transform",
  ],
});

export const selectGroup = tv({
  base: "",
});

export const selectItem = tv({
  base: [
    "data-highlighted:bg-accent data-highlighted:text-accent-foreground focus:bg-accent focus:text-accent-foreground relative flex w-full cursor-default items-center gap-2 rounded-sm py-1.5 pr-8 pl-2 text-sm outline-hidden select-none",
    "data-disabled:pointer-events-none data-disabled:opacity-50",
  ],
  variants: {
    inset: {
      true: "pl-8",
    },
    disabled: {
      true: "pointer-events-none opacity-50",
    },
  },
  defaultVariants: {
    inset: false,
    disabled: false,
  },
});

export const selectItemIndicator = tv({
  base: "pointer-events-none absolute right-2 flex size-3.5 items-center justify-center",
});

export const selectItemText = tv({
  base: "",
});

export const selectLabel = tv({
  base: "text-muted-foreground px-2 py-1.5 text-sm font-medium",
});

export const selectList = tv({
  base: "max-h-96 overflow-x-hidden overflow-y-auto p-1",
});

export const selectScrollButton = tv({
  base: "bg-popover text-muted-foreground flex w-full cursor-default items-center justify-center py-1 [&>svg]:size-4",
});

export const selectSeparator = tv({
  base: "bg-border -mx-1 my-1 h-px",
});

export const selectTrigger = tv({
  base: [
    "border-input data-[placeholder]:text-muted-foreground [&_svg:not([class*='text-'])]:text-muted-foreground focus-visible:border-outline focus-visible:ring-outline/50 aria-invalid:ring-error/20 aria-invalid:border-error",
    "data-[size=default]:h-9 data-[size=sm]:h-8 flex w-fit items-center justify-between gap-2 rounded-md border bg-transparent px-3 py-2 text-sm whitespace-nowrap shadow-xs transition-[color,box-shadow] outline-none focus-visible:ring-[3px]",
    "disabled:cursor-not-allowed disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  ],
  variants: {
    size: {
      default: "",
      sm: "",
    },
  },
  defaultVariants: {
    size: "default",
  },
});

export const selectValue = tv({
  base: "pointer-events-none",
});
