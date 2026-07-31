import type { PointerKind } from "@ui/usePointerKind";

/** The desktop pan/zoom advice, worded as it read in the toolbar row. */
export const CANVAS_POINTER_HINT = "Tip: Right-drag to pan, Wheel to zoom";

/**
 * The hint to float over the canvas for `pointer`, or `null` for none.
 *
 * Pure so the decision is testable without a DOM (and without a layout engine,
 * which jsdom lacks): `CanvasHint` only reads the pointer kind and renders
 * whatever comes back.
 *
 * A coarse pointer is shown *nothing* rather than a touch equivalent: neither
 * right-drag nor the wheel exists on a touch screen, and touch pan/zoom
 * gestures don't exist in the app yet (#84), so any replacement text would
 * promise a gesture that does nothing.
 */
export function canvasHintForPointer(pointer: PointerKind): string | null {
  return pointer === "coarse" ? null : CANVAS_POINTER_HINT;
}
