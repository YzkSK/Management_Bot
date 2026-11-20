import { tv } from "tailwind-variants";

// 移行前のRadix版Tabsと同じ見た目に固定している。
export const tabs = tv({
  base: "flex flex-col gap-2",
});

export const tabsContent = tv({
  base: "flex flex-col gap-2",
});

export const tabsLabel = tv({
  base: "max-sm:sr-only max-sm:group-data-[state=active]:not-sr-only",
});

// スマホ幅では横幅いっぱいに広げ、タブを中央に寄せる。
export const tabsList = tv({
  base: "flex gap-1 border-b max-sm:w-full max-sm:justify-center",
});

export const tabsTrigger = tv({
  base: "group inline-flex items-center justify-center gap-1.5 [&_svg]:size-4 [&_svg]:shrink-0 text-muted-foreground data-[state=active]:text-foreground data-[state=active]:border-primary -mb-px border-b-2 border-transparent px-2 py-2 text-sm whitespace-nowrap sm:px-3 font-medium transition-colors focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50",
});
