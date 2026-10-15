import { tv } from "tailwind-variants";

export const alert = tv({
  base: "relative grid w-full grid-cols-[0_1fr] items-start gap-y-0.5 rounded-lg border px-4 py-3 text-sm has-[>svg]:grid-cols-[calc(var(--spacing)*4)_1fr] has-[>svg]:gap-x-3 [&>svg]:size-4 [&>svg]:translate-y-0.5 [&>svg]:text-current",
  variants: {
    variant: {
      default: "bg-card text-card-foreground",
      error: "text-error bg-card *:data-[slot=alert-description]:text-error/90",
      success: "border-success/30 bg-success/10 text-success *:data-[slot=alert-description]:text-success",
      warning: "border-warning/30 bg-warning/10 text-warning *:data-[slot=alert-description]:text-warning",
      info: "border-blue-200 bg-blue-50 text-blue-900 dark:border-blue-900 dark:bg-blue-950 dark:text-blue-100",
    },
  },
  defaultVariants: {
    variant: "default",
  },
});

export const alertDescription = tv({
  base: "text-muted-foreground col-start-2 grid justify-items-start gap-1 text-sm [&_p]:leading-relaxed",
});

export const alertTitle = tv({
  base: "col-start-2 line-clamp-1 min-h-4 font-medium tracking-tight",
});
