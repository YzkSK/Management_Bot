import type * as React from "react";
import { alertDescription } from "./variants";

export type AlertDescriptionProps = React.ComponentPropsWithoutRef<"div"> & {
  ref?: React.Ref<HTMLDivElement>;
};

function AlertDescription(props: AlertDescriptionProps) {
  const { ref, className, children, ...rest } = props;

  return (
    <div
      data-sw-alert-description
      className={alertDescription({ class: className })}
      {...rest}
      ref={ref}
      data-slot="alert-description"
    >
      {children}
    </div>
  );
}

export default AlertDescription;
