"use client";

import DialogPrimitive from "@starwind-ui/react/dialog";
import type * as React from "react";
import { useDialogLabelId } from "./DialogContent";
import { dialogTitle } from "./variants";

export type DialogTitleProps = React.ComponentPropsWithoutRef<"h2">;

function DialogTitle(props: DialogTitleProps) {
  const { className, children, ...rest } = props;
  const titleId = useDialogLabelId("title");

  return (
    <DialogPrimitive.Title
      className={dialogTitle({ class: className })}
      {...rest}
      // DialogContentのaria-labelledbyと必ず一致させるため、生成したidを優先する。
      id={titleId}
      data-slot="dialog-title"
    >
      {children}
    </DialogPrimitive.Title>
  );
}

export default DialogTitle;
