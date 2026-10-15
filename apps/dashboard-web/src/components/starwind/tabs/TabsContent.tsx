"use client";

import TabsPrimitive, { useTabsContext } from "@starwind-ui/react/tabs";
import type * as React from "react";
import { tabsContent } from "./variants";

export type TabsContentProps = React.ComponentPropsWithoutRef<"div"> & {
  keepMounted?: boolean;
  ref?: React.Ref<HTMLDivElement>;
  value: string;
};

function TabsContent(props: TabsContentProps) {
  const { keepMounted, ref, value, className, children, ...rest } = props;
  const { value: selected } = useTabsContext();

  return (
    <TabsPrimitive.Panel
      className={tabsContent({ class: className })}
      keepMounted={keepMounted}
      ref={ref}
      value={value}
      {...rest}
      data-slot="tabs-content"
    >
      {/* Radix同様、非アクティブなタブの中身はマウントしない(クエリ等の無駄な実行を避ける) */}
      {keepMounted || selected === value ? children : null}
    </TabsPrimitive.Panel>
  );
}

export default TabsContent;
