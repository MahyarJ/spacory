import type { Plan } from "@app/schema";

export function selectionCount(
  selWalls: ReadonlySet<string>,
  selItems: ReadonlySet<string>,
  selLabels?: ReadonlySet<string>,
) {
  return selWalls.size + selItems.size + (selLabels?.size ?? 0);
}

export function isWallOnlySelection(
  selWalls: ReadonlySet<string>,
  selItems: ReadonlySet<string>,
  selLabels: ReadonlySet<string>,
) {
  return selWalls.size > 0 && selItems.size === 0 && selLabels.size === 0;
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
 * selected, including labels. `H`/`S` apply when a door is selected.
 */
export function selectionActions(
  plan: Plan,
  selWalls: Set<string>,
  selItems: Set<string>,
  selLabels?: ReadonlySet<string>,
): SelectionAction[] {
  if (selectionCount(selWalls, selItems, selLabels) === 0) return [];
  return hasSelectedDoor(plan, selItems)
    ? ["remove", "hinge", "swing"]
    : ["remove"];
}
