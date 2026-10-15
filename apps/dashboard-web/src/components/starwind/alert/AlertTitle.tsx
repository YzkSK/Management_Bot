import type * as React from "react";
import { alertTitle } from "./variants";

export type AlertTitleProps = React.ComponentPropsWithoutRef<"div"> & {
  ref?: React.Ref<HTMLDivElement>;
};

function AlertTitle(props: AlertTitleProps) {
  const { ref, className, children, ...rest } = props;

  return (
    <div
      data-sw-alert-title
      className={alertTitle({ class: className })}
      {...rest}
      ref={ref}
      data-slot="alert-title"
    >
      {children}
    </div>
  );
}

export default AlertTitle;
