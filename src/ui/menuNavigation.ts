/** Keyboard moves a WAI-ARIA menu supports for its roving focus. */
export type MenuMove = "next" | "prev" | "first" | "last";

/**
 * Index the roving focus lands on after `move`, wrapping around the ends.
 *
 * Pure so the wrapping rules are testable without a DOM: `Menu` only translates
 * key events into a move and focuses whatever index comes back.
 */
export function nextMenuIndex(
  current: number,
  count: number,
  move: MenuMove,
): number {
  if (count <= 0) return -1;
  switch (move) {
    case "first":
      return 0;
    case "last":
      return count - 1;
    case "next":
      return current >= count - 1 || current < 0 ? 0 : current + 1;
    case "prev":
      return current <= 0 ? count - 1 : current - 1;
  }
}

/**
 * Whether an open menu should swallow `key` even though it navigates nowhere.
 *
 * A vertical menu has no horizontal navigation, but the horizontal arrows are a
 * natural thing to press while arrowing through it — and letting them through
 * hands them to the app's global shortcuts, which is how "picking an export
 * format" ends up nudging the plan.
 */
export function isMenuSwallowedKey(key: string): boolean {
  return key === "ArrowLeft" || key === "ArrowRight";
}

/** The move a key press maps to, or `null` if the menu shouldn't handle it. */
export function menuMoveForKey(key: string): MenuMove | null {
  switch (key) {
    case "ArrowDown":
      return "next";
    case "ArrowUp":
      return "prev";
    case "Home":
      return "first";
    case "End":
      return "last";
    default:
      return null;
  }
}
