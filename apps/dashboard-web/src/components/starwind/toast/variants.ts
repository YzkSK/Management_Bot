import { tv } from "tailwind-variants";

export const toastAction = tv({
  base: [
    "border-input bg-background hover:bg-accent hover:text-accent-foreground focus-visible:ring-outline/50 mt-2 inline-flex h-8 w-fit items-center justify-center rounded-md border px-3 text-xs font-medium transition-colors outline-none focus-visible:ring-2",
    "disabled:pointer-events-none disabled:opacity-50",
  ],
});

export const toastClose = tv({
  base: "text-muted-foreground hover:text-foreground absolute top-2 right-2 rounded-md p-1 opacity-70 transition-opacity hover:opacity-100 focus-visible:ring-2 focus-visible:outline-none",
});

export const toastContent = tv({
  base: "grid gap-1 transition-opacity duration-200 data-behind:opacity-0 data-expanded:opacity-100",
});

export const toastDescription = tv({
  base: "text-muted-foreground text-sm",
});

export const toastItem = tv({
  base: "bg-popover text-popover-foreground pointer-events-auto absolute inset-x-0 bottom-0 flex w-full origin-bottom flex-col gap-1 overflow-hidden rounded-lg border bg-clip-padding p-4 pr-10 shadow-lg transition-[transform,opacity] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] data-limited:pointer-events-none data-limited:opacity-0",
  variants: {
    variant: {
      default: "border-border",
      // 移行前のsonner richColorsに合わせ、背景・文字・枠をまとめて色付けする。
      success:
        "border-green-200 bg-green-50 text-green-700 dark:border-green-900 dark:bg-green-950 dark:text-green-300 [&_[data-slot=toast-description]]:text-current",
      error:
        "border-red-200 bg-red-50 text-red-600 dark:border-red-900 dark:bg-red-950 dark:text-red-300 [&_[data-slot=toast-description]]:text-current",
      warning:
        "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300 [&_[data-slot=toast-description]]:text-current",
      info: "border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-900 dark:bg-blue-950 dark:text-blue-300 [&_[data-slot=toast-description]]:text-current",
    },
  },
  defaultVariants: {
    variant: "default",
  },
});

export const toastTitle = tv({
  base: "flex items-center gap-1 text-sm font-semibold [&_svg]:size-4",
  variants: {
    variant: {
      default: "",
      success: "[&_svg]:text-success",
      error: "[&_svg]:text-error",
      warning: "[&_svg]:text-warning",
      info: "[&_svg]:text-info",
      loading: "[&_svg]:text-muted-foreground",
    },
  },
  defaultVariants: {
    variant: "default",
  },
});

export const toastViewport = tv({
  base: [
    // 幅は移行前のsonner(356px)に合わせる。
    "fixed z-50 flex w-[356px] max-w-[calc(100vw-2rem)] outline-none",
    "data-[position=bottom-center]:bottom-4 data-[position=bottom-center]:left-1/2 data-[position=bottom-center]:-translate-x-1/2",
    "data-[position=bottom-left]:bottom-4 data-[position=bottom-left]:left-4",
    "data-[position=bottom-right]:right-4 data-[position=bottom-right]:bottom-4",
    "data-[position=top-center]:top-4 data-[position=top-center]:left-1/2 data-[position=top-center]:-translate-x-1/2",
    "data-[position=top-left]:top-4 data-[position=top-left]:left-4",
    "data-[position=top-right]:top-4 data-[position=top-right]:right-4",
  ],
});
