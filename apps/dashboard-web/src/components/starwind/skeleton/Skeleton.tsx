import type * as React from "react";
import { skeleton } from "./variants";

export type SkeletonProps = Omit<React.ComponentPropsWithoutRef<"span">, "children"> & {
  ref?: React.Ref<HTMLSpanElement>;
};

/** ボタンや文中にも置けるよう、divではなくblockのspanで描く。 */
function Skeleton(props: SkeletonProps) {
  const { ref, className, ...rest } = props;

  return (
    <span
      data-sw-skeleton
      className={skeleton({ class: className })}
      {...rest}
      ref={ref}
      data-slot="skeleton"
    />
  );
}

export default Skeleton;
