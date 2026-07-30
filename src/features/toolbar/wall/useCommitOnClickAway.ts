import { useEffect, useRef } from "react";
import { commitDraftOnOutsidePointerDown } from "./draftField";

/**
 * Commit a draft field when the user clicks away onto the canvas (or anywhere
 * else outside it), which otherwise unmounts the focused input without ever
 * firing `blur`. Returns the ref to put on the field's root element.
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
        getActiveElement: () => document.activeElement,
        commit: () => commitRef.current(),
      }),
    [],
  );

  return fieldRef;
}
