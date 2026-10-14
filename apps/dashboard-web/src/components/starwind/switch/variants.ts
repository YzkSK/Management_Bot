import { tv } from "tailwind-variants";

export const switchWrapper = tv({
  base: "inline-flex shrink-0 items-center",
});

// 既存のRadix Switchと同じ見た目(h-[1.15rem] w-8 / つまみsize-4)に固定している。
export const switchButton = tv({
  base: [
    "group peer inline-flex h-[1.15rem] w-8 shrink-0 items-center rounded-full border border-transparent bg-input shadow-xs transition-all outline-none",
    "aria-checked:bg-primary focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50",
    "disabled:cursor-not-allowed disabled:opacity-50",
  ],
  variants: {
    variant: {
      default: "",
    },
  },
  defaultVariants: {
    variant: "default",
  },
});

export const switchToggle = tv({
  base: [
    "pointer-events-none block size-4 rounded-full bg-background ring-0 transition-transform",
    "group-aria-checked:translate-x-[calc(100%-2px)] group-aria-[checked=false]:translate-x-0",
  ],
  variants: {
    size: {
      sm: "",
      md: "",
      lg: "",
    },
  },
  defaultVariants: {
    size: "md",
  },
});

export const switchLabel = tv({
  base: "text-foreground ml-2 font-medium peer-disabled:cursor-not-allowed peer-disabled:opacity-70",
  variants: {
    size: {
      sm: "text-sm",
      md: "text-base",
      lg: "text-lg",
    },
  },
  defaultVariants: {
    size: "md",
  },
});
