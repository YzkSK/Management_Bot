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
      className={dialogDescription({ class: className })}
      {...rest}
      // DialogContentのaria-describedbyと必ず一致させるため、生成したidを優先する。
      id={descriptionId}
      data-slot="dialog-description"
    >
      {children}
    </DialogPrimitive.Description>
  );
}

export default DialogDescription;
