import { tv } from "tailwind-variants";

export const collapsible = tv({
  base: "",
});

export const collapsibleContent = tv({
  // 高さのアニメーションはランタイムが設定する--starwind-collapsible-panel-heightを参照する(keyframesはstyles/starwind.css)。
  base: "overflow-hidden data-[state=open]:animate-collapsible-down data-[state=closed]:animate-collapsible-up",
});

export const collapsibleTrigger = tv({
  base: "",
});
