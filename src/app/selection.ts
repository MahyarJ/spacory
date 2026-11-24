import type { Plan } from "@app/schema";

export function selectionCount(
  selWalls: ReadonlySet<string>,
  selItems: ReadonlySet<string>,
  selLabels?: ReadonlySet<string>,
  selFixtures?: ReadonlySet<string>,
) {
  return (
    selWalls.size +
    selItems.size +
    (selLabels?.size ?? 0) +
    (selFixtures?.size ?? 0)
  );
}

export function isWallOnlySelection(
  selWalls: ReadonlySet<string>,
  selItems: ReadonlySet<string>,
  selLabels: ReadonlySet<string>,
  selFixtures?: ReadonlySet<string>,
) {
  return (
    selWalls.size > 0 &&
    selectionCount(selWalls, selItems, selLabels, selFixtures) === selWalls.size
  );
}

export function hasSelectedDoor(plan: Plan, selItems: Set<string>) {
  if (selItems.size === 0) return false;
  return plan.items.some(
    (item) => selItems.has(item.id) && item.type === "door",
  );
}

/** A verb the floating options bar can offer for the current selection. */
export type SelectionAction =
  | "remove"
  | "hinge"
  | "swing"
  | "rotate"
  | "duplicate";

/**
 * The action controls that apply to a selection, in the order the bar shows
 * them — the decision behind `WallOptions`' buttons, lifted out so it is
 * testable without a DOM.
 *
 * `Delete` removes any selection. `H`/`S` apply when a door is selected.
 * A single fixture also offers Rotate and Duplicate.
 */
export function selectionActions(
  plan: Plan,
  selWalls: Set<string>,
  selItems: Set<string>,
  selLabels?: ReadonlySet<string>,
  selFixtures?: ReadonlySet<string>,
): SelectionAction[] {
  const count = selectionCount(selWalls, selItems, selLabels, selFixtures);
  if (count === 0) return [];
  if (count === 1 && selFixtures?.size === 1)
    return ["rotate", "duplicate", "remove"];
  return hasSelectedDoor(plan, selItems)
    ? ["remove", "hinge", "swing"]
    : ["remove"];
}
