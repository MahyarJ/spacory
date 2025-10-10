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
    (item) => selItems.has(item.id) && item.type === "door"
  );
}
