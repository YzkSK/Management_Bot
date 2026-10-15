import type * as React from "react";
import type { VariantProps } from "tailwind-variants";
import { alert } from "./variants";

export type AlertProps = React.ComponentPropsWithoutRef<"div"> &
  VariantProps<typeof alert> & {
    ref?: React.Ref<HTMLDivElement>;
  };

function Alert(props: AlertProps) {
  const { variant, role = "alert", ref, className, children, ...rest } = props;

  return (
    <div
      data-sw-alert
      className={alert({ variant, class: className })}
      role={role}
      {...rest}
      ref={ref}
      data-slot="alert"
    >
      {children}
    </div>
  );
}

export default Alert;
