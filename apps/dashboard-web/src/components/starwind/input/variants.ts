import { tv } from "tailwind-variants";

export const input = tv({
  base: [
    "border-input file:text-foreground placeholder:text-muted-foreground selection:bg-primary selection:text-primary-foreground flex w-full min-w-0 rounded-md border bg-transparent py-1 shadow-xs transition-[color,box-shadow] outline-none file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50",
    "focus-visible:border-outline focus-visible:ring-outline/50 focus-visible:ring-[3px]",
    "aria-invalid:ring-error/20 aria-invalid:border-error",
  ],
  variants: {
    size: {
      sm: "h-8 px-2 text-sm",
      md: "h-9 px-3 text-sm",
      lg: "h-11 px-4 text-base",
    },
  },
  defaultVariants: {
    size: "md",
  },
});
