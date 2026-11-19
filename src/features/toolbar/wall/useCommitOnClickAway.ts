import { useEffect, useRef } from "react";
import {
  commitDraftOnOutsidePointerDown,
  type PointerDownLike,
} from "./draftField";
import styles from "./WallOptions.module.css";

/**
 * Commit a draft field before a press on the canvas can unmount the focused
 * input without firing `blur`. Track touches within the bar so blur can keep
 * the tapped control in place through the browser's click.
 *
 * Shared by the options bar's fields so they behave identically — see
 * `draftField.ts` for why this listens on the document's capture phase.
 */
export function useCommitOnClickAway(commit: () => void) {
  const fieldRef = useRef<HTMLFormElement>(null);
  const barTouch = useRef<PointerDownLike | null>(null);
  // Keep the latest commit (it closes over the current draft) behind a ref so
  // the listener is installed once, on mount.
  const commitRef = useRef(commit);
  useEffect(() => {
    commitRef.current = commit;
  });

  useEffect(() => {
    const stopClickAway = commitDraftOnOutsidePointerDown({
      source: document,
      getField: () => fieldRef.current,
      getActiveElement: () => document.activeElement,
      deferToBlur: (event) => {
        const bar = fieldRef.current?.closest(`.${styles.bar}`);
        if (
          event.pointerType === "touch" &&
          event.target instanceof Node &&
          bar?.contains(event.target)
        ) {
          barTouch.current = event;
          return true;
        }
        barTouch.current = null;
        return false;
      },
      commit: () => commitRef.current(),
    });

    const releaseTouch = (event: PointerEvent) => {
      const press = barTouch.current;
      if (!press || press.pointerId !== event.pointerId) return;
      if (event.type === "pointercancel") {
        barTouch.current = null;
        return;
      }
      // The focus change can follow pointerup. Discard any unused press once
      // the browser has had a chance to deliver the tap.
      requestAnimationFrame(() => {
        if (barTouch.current === press) barTouch.current = null;
      });
    };
    document.addEventListener("pointerup", releaseTouch, true);
    document.addEventListener("pointercancel", releaseTouch, true);
    return () => {
      stopClickAway();
      document.removeEventListener("pointerup", releaseTouch, true);
      document.removeEventListener("pointercancel", releaseTouch, true);
      barTouch.current = null;
    };
  }, []);

  return {
    fieldRef,
    consumeBarTouch: () => {
      const touchedBar = barTouch.current !== null;
      barTouch.current = null;
      return touchedBar;
    },
  };
}
