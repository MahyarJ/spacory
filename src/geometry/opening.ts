/** Smallest width (cm) a newly created opening (door/window) may span. */
export const MIN_OPENING_WIDTH = 5;

/**
 * Derive an opening's placement along a wall from two offsets (in cm, already
 * snapped to the grid). The lower offset becomes the start and the absolute
 * distance between them becomes the length, so the direction the user dragged
 * in doesn't matter.
 *
 * Returns `null` when the span is below `minWidth` — a degenerate drag makes no
 * opening rather than a zero/near-zero one. (The click-click flow keeps its own
 * "clamp up to the minimum" behaviour; this is the drag rule.)
 */
export function openingPlacementFromOffsets(
  startOffset: number,
  endOffset: number,
  minWidth = MIN_OPENING_WIDTH,
): { offset: number; length: number } | null {
  const offset = Math.min(startOffset, endOffset);
  const length = Math.abs(endOffset - startOffset);
  if (length < minWidth) return null;
  return { offset, length };
}

/**
 * Resize an existing opening to a requested width along its wall, keeping it on
 * the wall. Given the opening's current placement (`{ offset, length }`), the
 * host wall's length, and a requested width, return the new `{ offset, length }`
 * obeying:
 *
 * - the width is clamped to at least `minWidth` and at most `wallLength` (so an
 *   over-long request that can't fit even at `offset 0` shrinks to the wall's
 *   length);
 * - the opening stays fully on its wall (`offset ≥ 0` and
 *   `offset + length ≤ wallLength`): the current offset is held where possible,
 *   and shifted back toward endpoint `a` only as far as needed to make the new
 *   width fit against the far end.
 */
export function resizeOpeningWidth(
  attach: { offset: number; length: number },
  wallLength: number,
  requestedWidth: number,
  minWidth = MIN_OPENING_WIDTH,
): { offset: number; length: number } {
  const length = Math.max(minWidth, Math.min(requestedWidth, wallLength));
  // Hold the current offset, but shift back so the opening's far end lands on
  // (or before) the wall's end. `Math.max(0, …)` keeps `offset ≥ 0`.
  const offset = Math.max(0, Math.min(attach.offset, wallLength - length));
  return { offset, length };
}
