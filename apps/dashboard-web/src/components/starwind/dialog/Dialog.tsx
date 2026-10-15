"use client";

import DialogPrimitive from "@starwind-ui/react/dialog";
import { createContext, useContext, useState } from "react";
import type * as React from "react";
import { flushSync } from "react-dom";

export type DialogProps = React.ComponentPropsWithoutRef<"div"> & {
  defaultOpen?: boolean;
  open?: boolean;
  closeOnEscape?: boolean;
  closeOnOutsideInteract?: boolean;
  modal?: boolean;
  onCloseComplete?: (details: import("@starwind-ui/react/dialog").DialogCloseCompleteDetails) => void;
  onOpenChange?: (open: boolean, details: import("@starwind-ui/react/dialog").DialogOpenChangeDetails) => void;
};

// Starwindの<dialog>は閉じていてもDOMに残るため、Radix同様に閉じている間は中身をマウントしない。
// 開いた直後にshowModalが最初のフォーカス先を探せるよう、開く通知の時点で同期的にマウントする。
const DialogMountedContext = createContext(false);

export function useDialogMounted(): boolean {
  return useContext(DialogMountedContext);
}

function Dialog(props: DialogProps) {
  const {
    defaultOpen = false,
    open,
    closeOnEscape = true,
    closeOnOutsideInteract = true,
    modal = true,
    onCloseComplete,
    onOpenChange,
    className,
    children,
    ...rest
  } = props;
  const [mounted, setMounted] = useState(open ?? defaultOpen);
  if (open === true && !mounted) setMounted(true);

  return (
    <DialogMountedContext.Provider value={mounted}>
      <DialogPrimitive.Root
        // Radix同様、Rootはレイアウトに影響させない。
        className={["contents", className].filter(Boolean).join(" ")}
        defaultOpen={defaultOpen}
        open={open}
        closeOnEscape={closeOnEscape}
        closeOnOutsideInteract={closeOnOutsideInteract}
        modal={modal}
        onCloseComplete={(details) => {
          setMounted(false);
          onCloseComplete?.(details);
        }}
        onOpenChange={(next, details) => {
          if (next) flushSync(() => setMounted(true));
          onOpenChange?.(next, details);
        }}
        {...rest}
        data-slot="dialog"
      >
        {children}
      </DialogPrimitive.Root>
    </DialogMountedContext.Provider>
  );
}

export default Dialog;
