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
