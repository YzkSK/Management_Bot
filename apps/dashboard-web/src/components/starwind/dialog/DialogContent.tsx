"use client";

import { createContext, useContext, useId, useLayoutEffect, useState } from "react";
import type * as React from "react";
import DialogPrimitive from "@starwind-ui/react/dialog";
import { useDialogMounted } from "./Dialog";
import { dialogBackdrop, dialogContent } from "./variants";

type LabelKind = "title" | "description";

type DialogLabelContextValue = {
  titleId?: string;
  descriptionId?: string;
  register?: (kind: LabelKind) => () => void;
};

// ランタイムは初期化時にしかTitle/Descriptionを探さず、閉時は中身をマウントしないため紐付けが漏れる。
// idをこちらで振り、実際に描画されているものだけaria-labelledby/aria-describedbyで明示する。
const DialogLabelContext = createContext<DialogLabelContextValue>({});

/** DialogTitle/DialogDescriptionから呼び、描画中であることを登録して自分のidを受け取る。 */
export function useDialogLabelId(kind: LabelKind): string | undefined {
  const { titleId, descriptionId, register } = useContext(DialogLabelContext);
  useLayoutEffect(() => register?.(kind), [register, kind]);
  return kind === "title" ? titleId : descriptionId;
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
  const [hasTitle, setHasTitle] = useState(false);
  const [hasDescription, setHasDescription] = useState(false);
  const [register] = useState(() => (kind: LabelKind) => {
    const set = kind === "title" ? setHasTitle : setHasDescription;
    set(true);
    return () => set(false);
  });

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
        aria-labelledby={hasTitle ? titleId : undefined}
        aria-describedby={hasDescription ? descriptionId : undefined}
        {...rest}
        data-slot="dialog-content"
      >
        <DialogLabelContext.Provider value={{ titleId, descriptionId, register }}>
          {mounted ? children : null}
        </DialogLabelContext.Provider>
      </DialogPrimitive.Popup>
    </>
  );
}

export default DialogContent;
