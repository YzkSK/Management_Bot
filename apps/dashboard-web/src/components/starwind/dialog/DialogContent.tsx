"use client";

import type * as React from "react";
import DialogPrimitive from "@starwind-ui/react/dialog";
import { useDialogMounted } from "./Dialog";
import { dialogBackdrop, dialogContent } from "./variants";

export type DialogContentProps = React.ComponentPropsWithoutRef<"dialog"> & {
  backdrop?: React.ReactNode;
};

// 閉じるボタンは持たない(既存のRadix版と同様、必要な画面がDialogCloseを置く)。
function DialogContent(props: DialogContentProps) {
  const { className, children, backdrop, ...rest } = props;
  const mounted = useDialogMounted();

  return (
    <>
      {backdrop ?? (
        <DialogPrimitive.Backdrop
          className={dialogBackdrop()}
          data-state="closed"
          hidden
          data-slot="dialog-backdrop"
        />
      )}

      <DialogPrimitive.Popup
        className={dialogContent({ class: className })}
        data-state="closed"
        {...rest}
        data-slot="dialog-content"
      >
        {mounted ? children : null}
      </DialogPrimitive.Popup>
    </>
  );
}

export default DialogContent;
