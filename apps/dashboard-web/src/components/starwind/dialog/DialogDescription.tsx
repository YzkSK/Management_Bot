"use client";

import DialogPrimitive from "@starwind-ui/react/dialog";
import type * as React from "react";
import { useDialogLabelId } from "./DialogContent";
import { dialogDescription } from "./variants";

export type DialogDescriptionProps = React.ComponentPropsWithoutRef<"p">;

function DialogDescription(props: DialogDescriptionProps) {
  const { className, children, ...rest } = props;
  const descriptionId = useDialogLabelId("description");

  return (
    <DialogPrimitive.Description
      id={descriptionId}
      className={dialogDescription({ class: className })}
      {...rest}
      data-slot="dialog-description"
    >
      {children}
    </DialogPrimitive.Description>
  );
}

export default DialogDescription;
