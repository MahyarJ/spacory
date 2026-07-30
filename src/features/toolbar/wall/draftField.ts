/**
 * Shared logic for the options bar's inline draft fields (wall length, opening
 * width): parsing a typed draft, and deciding when a pointer press elsewhere in
 * the app should commit it.
 *
 * Extracted out of the components so it can be unit-tested (see
 * `src/ui/menuNavigation.ts` for the same precedent).
 */

/**
 * A pointer target or the focused element. Kept structural (rather than `Node`)
 * so the tests can stand in plain objects for DOM nodes — this module never
 * does more with one than compare identity via `contains`.
 */
export type TargetNode = object;

/** A node we can ask "is this target inside me?" — an element in the app. */
export interface DraftFieldNode {
  contains(node: TargetNode | null): boolean;
}

/** The subset of a `pointerdown` event this module needs. */
export interface PointerDownLike {
  target: TargetNode | null;
}

/** The subset of `document` this module listens on. */
export interface PointerDownSource {
  addEventListener(
    type: "pointerdown",
    listener: (event: PointerDownLike) => void,
    options: { capture: boolean },
  ): void;
  removeEventListener(
    type: "pointerdown",
    listener: (event: PointerDownLike) => void,
    options: { capture: boolean },
  ): void;
}

/**
 * Parse a field's draft string, returning the value to apply or `null` when the
 * draft is invalid (empty, non-numeric, or below the field's minimum). Both
 * fields — and every commit path (Enter, blur, click-away) — funnel through
 * this, so an invalid draft is rejected identically everywhere.
 */
export function parseDraft(draft: string, min: number): number | null {
  // `Number("")` is 0, which would sneak past the finite check.
  if (draft.trim() === "") return null;
  const parsed = Number(draft);
  if (!Number.isFinite(parsed) || parsed < min) return null;
  return parsed;
}

/**
 * Should a `pointerdown` commit this field's draft?
 *
 * Yes when the press landed outside the field while the field still holds
 * focus — i.e. the user is clicking away. A press inside the field (its input,
 * label or unit suffix) is not a click-away, and a press while the field is
 * unfocused can't be one either: blur already committed the draft.
 */
export function isCommittingPointerDown(
  field: DraftFieldNode | null,
  target: TargetNode | null,
  activeElement: TargetNode | null,
): boolean {
  if (!field) return false;
  if (!field.contains(activeElement)) return false;
  return !field.contains(target);
}

/**
 * Commit a focused draft field when a pointer press lands outside it, *before*
 * React processes that press.
 *
 * This is the fix for click-away losing a typed value: pressing the canvas
 * clears (or moves) the selection, which unmounts the field — and unmounting a
 * focused input does not fire `blur`, so `onBlur={commit}` never runs. Listening
 * on the document's capture phase runs ahead of React's root-level handler, so
 * the value is applied while the field (and the selection it targets) still
 * exists.
 *
 * Returns a cleanup function that removes the listener.
 */
export function commitDraftOnOutsidePointerDown({
  source,
  getField,
  getActiveElement,
  commit,
}: {
  source: PointerDownSource;
  getField: () => DraftFieldNode | null;
  getActiveElement: () => TargetNode | null;
  commit: () => void;
}): () => void {
  const onPointerDown = (event: PointerDownLike) => {
    if (isCommittingPointerDown(getField(), event.target, getActiveElement())) {
      commit();
    }
  };
  source.addEventListener("pointerdown", onPointerDown, { capture: true });
  return () =>
    source.removeEventListener("pointerdown", onPointerDown, {
      capture: true,
    });
}
