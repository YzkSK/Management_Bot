"use client";

import type * as React from "react";
import { tabsLabel } from "./variants";

// スマホ幅では選択中のタブだけラベルを見せ、他はアイコンのみ(読み上げ用にsr-onlyで残す)。
function TabsLabel({ className, ...rest }: React.ComponentPropsWithoutRef<"span">) {
  return <span data-slot="tabs-label" className={tabsLabel({ class: className })} {...rest} />;
}

export default TabsLabel;
