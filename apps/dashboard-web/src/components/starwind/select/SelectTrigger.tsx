"use client";

import SelectPrimitive from "@starwind-ui/react/select";
import { IconChevronDown } from "@tabler/icons-react";
import type * as React from "react";
import type { VariantProps } from "tailwind-variants";
import { selectTrigger, selectValue } from "./variants";

export type SelectTriggerProps = React.ComponentPropsWithoutRef<"button"> &
  VariantProps<typeof selectTrigger> & {
    asChild?: boolean;
    iconClass?: string;
    placeholder?: string;
    showIcon?: boolean;
    valueClass?: string;
    icon?: React.ReactNode;
  };

function SelectTrigger(props: SelectTriggerProps) {
  const {
    asChild = false,
    className,
    iconClass: iconClassName,
    placeholder,
    showIcon = true,
    size = "default",
    valueClass: valueClassName,
    children,
    icon,
    ...rest
  } = props;

  return (
    <SelectPrimitive.Trigger
      className={selectTrigger({ size, class: className })}
      asChild={asChild}
      {...rest}
      data-size={size}
      data-slot="select-trigger"
    >
      {children ?? (
        <SelectPrimitive.Value
          className={selectValue({ class: valueClassName })}
          placeholder={placeholder}
          data-slot="select-value"
        />
      )}

      {!asChild && showIcon && (
        <SelectPrimitive.Icon className={["inline-flex", iconClassName].filter(Boolean).join(" ")} data-slot="select-icon">
          {icon ?? <IconChevronDown className="size-4 opacity-50" />}
        </SelectPrimitive.Icon>
      )}
    </SelectPrimitive.Trigger>
  );
}

export default SelectTrigger;
