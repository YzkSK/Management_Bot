"use client";

import { createContext, useContext, useId } from "react";
import type * as React from "react";
import DialogPrimitive from "@starwind-ui/react/dialog";
import { useDialogMounted } from "./Dialog";
import { dialogBackdrop, dialogContent } from "./variants";

// ランタイムは初期化時にしかTitle/Descriptionを探さず、閉時は中身をマウントしないため紐付けが漏れる。
// idをこちらで振り、aria-labelledby/aria-describedbyを明示する。
const DialogLabelIdsContext = createContext<{ titleId?: string; descriptionId?: string }>({});

export function useDialogLabelIds(): { titleId?: string; descriptionId?: string } {
  return useContext(DialogLabelIdsContext);
}

export type DialogContentProps = React.ComponentPropsWithoutRef<"dialog"> & {
  backdrop?: React.ReactNode;
};

// 閉じるボタンは持たない(既存のRadix版と同様、必要な画面がDialogCloseを置く)。
function DialogContent(props: DialogContentProps) {
  const { className, children, backdrop, ...rest } = props;
  const mounted = useDialogMounted();
  const baseId = useId();
  const titleId = `${baseId}-title`;
  const descriptionId = `${baseId}-description`;

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
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        {...rest}
        data-slot="dialog-content"
      >
        <DialogLabelIdsContext.Provider value={{ titleId, descriptionId }}>
          {mounted ? children : null}
        </DialogLabelIdsContext.Provider>
      </DialogPrimitive.Popup>
    </>
  );
}

export default DialogContent;
