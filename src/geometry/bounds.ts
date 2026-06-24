import type { Plan } from "@app/schema";
import { getPointOnWall } from "./wall";

/** Axis-aligned world-space bounding box, in cm. */
export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/**
 * Axis-aligned bounding box of everything drawn in a plan, in world cm.
 *
 * Walls are segments with a `thickness`; the drawn wall extends half its
 * thickness past its centerline, so each endpoint is padded by `thickness / 2`
 * on every side — a conservative box that fully contains the rendered wall.
 * Items (doors/windows) hold no absolute coordinates: they are resolved through
 * their wall attachment and padded by half their visual thickness the same way;
 * an item whose wall is missing is skipped. Returns null for an empty plan (no
 * walls and no resolvable items) so callers can fall back to a default view
 * instead of trying to frame nothing.
 */
export function getPlanBounds(plan: Plan): Bounds | null {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  let has = false;

  const include = (x: number, y: number, pad: number) => {
    if (x - pad < minX) minX = x - pad;
    if (y - pad < minY) minY = y - pad;
    if (x + pad > maxX) maxX = x + pad;
    if (y + pad > maxY) maxY = y + pad;
    has = true;
  };

  const wallsById = new Map<string, (typeof plan.walls)[number]>();
  for (const w of plan.walls) {
    wallsById.set(w.id, w);
    const pad = w.thickness / 2;
    include(w.a.x, w.a.y, pad);
    include(w.b.x, w.b.y, pad);
  }

  for (const item of plan.items) {
    const wall = wallsById.get(item.wallAttach.wallId);
    if (!wall) continue;
    const pad = item.thickness / 2;
    const start = getPointOnWall(wall, item.wallAttach.offset);
    const end = getPointOnWall(
      wall,
      item.wallAttach.offset + item.wallAttach.length,
    );
    include(start.x, start.y, pad);
    include(end.x, end.y, pad);
  }

  if (!has) return null;
  return { minX, minY, maxX, maxY };
}
