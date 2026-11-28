import { X } from "lucide-react";
import { type ReactNode, useEffect, useId, useRef } from "react";
import { Button } from "./Button";
import { ICON_SIZE } from "./constants";
import styles from "./Modal.module.css";

type ModalProps = {
  title: string;
  children: ReactNode;
  onClose: () => void;
  closeLabel?: string;
  dismissOnBackdrop?: boolean;
};

function isBackdropEvent(event: React.MouseEvent<HTMLDialogElement>): boolean {
  // The backdrop and the dialog's padding both target the dialog itself.
  if (event.target !== event.currentTarget) return false;
  const { left, right, top, bottom } =
    event.currentTarget.getBoundingClientRect();
  return (
    event.clientX < left ||
    event.clientX >= right ||
    event.clientY < top ||
    event.clientY >= bottom
  );
}

export function Modal({
  title,
  children,
  onClose,
  closeLabel = "Close dialog",
  dismissOnBackdrop = false,
}: ModalProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const backdropPress = useRef(false);
  const titleId = useId();

  useEffect(() => {
    const dialog = dialogRef.current!;
    dialog.showModal();
    return () => {
      if (dialog.open) dialog.close();
    };
  }, []);

  const close = () => {
    dialogRef.current!.close();
    onClose();
  };

  return (
    <dialog
      className={styles.dialog}
      ref={dialogRef}
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
      onPointerDown={(event) => {
        backdropPress.current =
          dismissOnBackdrop &&
          event.isPrimary &&
          event.button === 0 &&
          isBackdropEvent(event);
      }}
      onPointerCancel={() => {
        backdropPress.current = false;
      }}
      onClick={(event) => {
        const startedOnBackdrop = backdropPress.current;
        backdropPress.current = false;
        if (startedOnBackdrop && dismissOnBackdrop && isBackdropEvent(event)) {
          close();
        }
      }}
      // Keep keyboard events away from editor shortcuts while retaining
      // native navigation and Escape's cancel event.
      onKeyDown={(event) => event.stopPropagation()}
    >
      <header className={styles.header}>
        <h2 id={titleId} className={styles.title}>
          {title}
        </h2>
        <Button
          className={styles.close}
          aria-label={closeLabel}
          title="Close"
          onClick={close}
        >
          <X size={ICON_SIZE} aria-hidden="true" />
        </Button>
      </header>
      {children}
    </dialog>
  );
}
