"use client";

import SwitchPrimitive from "@starwind-ui/react/switch";
import type * as React from "react";
import type { VariantProps } from "tailwind-variants";
import { switchButton, switchLabel, switchToggle, switchWrapper } from "./variants";

export type SwitchProps = Omit<React.ComponentPropsWithoutRef<"button">, "aria-checked" | "defaultChecked" | "onChange" | "role" | "type"> &
  VariantProps<typeof switchButton> &
  VariantProps<typeof switchToggle> & {
    checked?: boolean;
    defaultChecked?: boolean;
    disabled?: boolean;
    form?: string;
    id?: string;
    label?: string;
    name?: string;
    onCheckedChange?: (checked: boolean, details: import("@starwind-ui/react/switch").SwitchCheckedChangeDetails) => void;
    readOnly?: boolean;
    ref?: React.Ref<HTMLSpanElement | HTMLButtonElement>;
    required?: boolean;
    uncheckedValue?: string;
    value?: string;
  };

function Switch(props: SwitchProps) {
  const {
    variant = "default",
    size = "md",
    checked,
    defaultChecked,
    disabled = false,
    form,
    id,
    label,
    name,
    onCheckedChange,
    readOnly = false,
    ref,
    required = false,
    uncheckedValue,
    value,
    className,
    ...rest
  } = props;

  // 固定の"switch"は付けない。親<label>や<label htmlFor>由来のアクセシブルネームを潰さないため。
  const ariaLabel = rest["aria-label"] ?? label;

  return (
    <div
      className={switchWrapper()}
      data-sw-switch-wrapper
      data-slot="switch-wrapper"
    >
      <SwitchPrimitive.Root
        className={switchButton({ variant, class: className })}
        checked={checked}
        defaultChecked={defaultChecked}
        disabled={disabled}
        form={form}
        id={id}
        name={name}
        nativeButton
        onCheckedChange={onCheckedChange}
        readOnly={readOnly}
        ref={ref}
        required={required}
        uncheckedValue={uncheckedValue}
        value={value}
        {...rest}
        aria-label={ariaLabel}
        data-slot="switch-button"
      >
        <SwitchPrimitive.Thumb
          className={switchToggle({ size })}
          data-slot="switch-toggle"
        />
      </SwitchPrimitive.Root>

      {label && (
        <label
          htmlFor={id}
          className={switchLabel({ size })}
          data-slot="switch-label"
        >
          {label}
        </label>
      )}
    </div>
  );
}

export default Switch;
