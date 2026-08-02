import type { Plan } from "@app/schema";

export function anySelection(selWalls: Set<string>, selItems: Set<string>) {
  return selWalls.size > 0 || selItems.size > 0;
}

export function hasSelectedWalls(selWalls: Set<string>) {
  return selWalls.size > 0;
}

export function hasSelectedDoor(plan: Plan, selItems: Set<string>) {
  if (selItems.size === 0) return false;
  return plan.items.some(
    (item) => selItems.has(item.id) && item.type === "door",
  );
}

/** A verb the floating options bar can offer for the current selection. */
export type SelectionAction = "remove" | "hinge" | "swing";

/**
 * The action controls that apply to a selection, in the order the bar shows
 * them — the decision behind `WallOptions`' buttons, lifted out so it is
 * testable without a DOM.
 *
 * Mirrors what the keyboard already does: `Delete` removes whatever is
 * selected (so `remove` needs only a non-empty selection, walls and openings
 * alike), while `H`/`S` retarget every selected door (so hinge/swing need at
 * least one door in the selection — a window has neither).
 */
export function selectionActions(
  plan: Plan,
  selWalls: Set<string>,
  selItems: Set<string>,
): SelectionAction[] {
  if (!anySelection(selWalls, selItems)) return [];
  return hasSelectedDoor(plan, selItems)
    ? ["remove", "hinge", "swing"]
    : ["remove"];
}
