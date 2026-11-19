import { useEffect, useRef } from "react";
import { commitDraftOnOutsidePointerDown } from "./draftField";
import styles from "./WallOptions.module.css";

/**
 * Commit a draft field before a press on the canvas can unmount the focused
 * input without firing `blur`. Returns the ref for the field's root element.
 *
 * Shared by the options bar's fields so they behave identically — see
 * `draftField.ts` for why this listens on the document's capture phase.
 */
export function useCommitOnClickAway(commit: () => void) {
  const fieldRef = useRef<HTMLFormElement>(null);
  // Keep the latest commit (it closes over the current draft) behind a ref so
  // the listener is installed once, on mount.
  const commitRef = useRef(commit);
  useEffect(() => {
    commitRef.current = commit;
  });

  useEffect(
    () =>
      commitDraftOnOutsidePointerDown({
        source: document,
        getField: () => fieldRef.current,
        getOptionsBar: () =>
          fieldRef.current?.closest(`.${styles.bar}`) ?? null,
        getActiveElement: () => document.activeElement,
        commit: () => commitRef.current(),
      }),
    [],
  );

  return fieldRef;
}
