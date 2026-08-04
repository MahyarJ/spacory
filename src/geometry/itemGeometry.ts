import type { DoorItem, Item, Point, Wall, WindowItem } from "@app/schema";
import {
  getPointOnWall,
  getWallAngle,
  getWallDirection,
  getWallLength,
} from "./wall";

/** A rotated rectangle: the opening cut into the wall for an item. */
export interface OpeningRect {
  x: number;
  y: number;
  width: number;
  height: number;
  /** Rotation in degrees, applied around (cx, cy) — matches SVG `rotate()`. */
  angleDeg: number;
  cx: number;
  cy: number;
}

export interface WindowGeometry {
  rect: OpeningRect;
  /** Midline drawn across the opening, in the wall's (pre-rotation) frame. */
  midline: { x1: number; y1: number; x2: number; y2: number };
}

export interface DoorGeometry {
  rect: OpeningRect;
  hinge: { x: number; y: number };
  tipClosed: { x: number; y: number };
  tipOpen: { x: number; y: number };
  /** SVG elliptical-arc sweep flag for the swing arc. */
  sweepFlag: 0 | 1;
  /** Arc radius — equal to the opening length. */
  radius: number;
}

function openingRect(
  wall: Wall,
  offset: number,
  length: number,
  thickness: number,
): OpeningRect {
  const angle = getWallAngle(wall);
  const c = getPointOnWall(wall, offset + length / 2);
  return {
    x: c.x - length / 2,
    y: c.y - thickness / 2,
    width: length,
    height: thickness,
    angleDeg: (angle * 180) / Math.PI,
    cx: c.x,
    cy: c.y,
  };
}

export function getWindowGeometry(
  item: WindowItem,
  wall: Wall,
): WindowGeometry {
  const { offset, length } = item.wallAttach;
  const rect = openingRect(wall, offset, length, item.thickness);
  return {
    rect,
    midline: {
      x1: rect.cx - length / 2,
      y1: rect.cy,
      x2: rect.cx + length / 2,
      y2: rect.cy,
    },
  };
}

export function getDoorGeometry(item: DoorItem, wall: Wall): DoorGeometry {
  const { offset, length } = item.wallAttach;
  const rect = openingRect(wall, offset, length, item.thickness);
  const dir = getWallDirection(wall);
  const n = { x: -dir.y, y: dir.x };

  // Hinge at the "end" edge midpoint (swap dir sign to switch hinge sides).
  const hingeEdge = item.props.hingeEdge === "start" ? -1 : +1;
  const hinge = {
    x: rect.cx + hingeEdge * dir.x * (length / 2),
    y: rect.cy + hingeEdge * dir.y * (length / 2),
  };

  // Closed leaf tip, along the wall direction from the hinge.
  const tipClosed = {
    x: hinge.x - hingeEdge * dir.x * length,
    y: hinge.y - hingeEdge * dir.y * length,
  };

  // side -> +1 = +normal (inside), -1 = -normal (outside)
  const side = item.props.swingSide === "inside" ? +1 : -1;
  const tipOpen = {
    x: hinge.x + side * n.x * length,
    y: hinge.y + side * n.y * length,
  };

  const sweepFlag: 0 | 1 = hingeEdge * side > 0 ? 0 : 1;

  return { rect, hinge, tipClosed, tipOpen, sweepFlag, radius: length };
}

/** The four axis-aligned directions whose circle extremes bound an arc. */
const AXIS_DIRECTIONS: Point[] = [
  { x: 1, y: 0 },
  { x: -1, y: 0 },
  { x: 0, y: 1 },
  { x: 0, y: -1 },
];

/**
 * The points whose axis-aligned bounding box exactly contains everything a door
 * sweeps outside its opening rect: the 90° swing arc, the open leaf line
 * (hinge → open tip) and the closed leaf (hinge → closed tip).
 *
 * The arc is a quarter circle centered on the hinge with `radius` equal to the
 * opening's length, spanning the quadrant between the closed and open tips. Its
 * exact box is therefore the two tips plus any of the circle's four
 * axis-aligned extreme points (hinge ± radius in x / y) that fall *inside* that
 * quadrant — tested by projecting the candidate direction onto the quadrant's
 * two edge unit vectors and requiring both to be non-negative. Padding the
 * hinge by the radius on all four sides would be far looser: it grows the box
 * on the three sides the leaf never reaches.
 */
export function getDoorSweepPoints(geometry: DoorGeometry): Point[] {
  const { hinge, tipClosed, tipOpen, radius } = geometry;
  // Unit vectors along the quadrant's two edges (perpendicular by construction).
  const u = {
    x: (tipClosed.x - hinge.x) / radius,
    y: (tipClosed.y - hinge.y) / radius,
  };
  const v = {
    x: (tipOpen.x - hinge.x) / radius,
    y: (tipOpen.y - hinge.y) / radius,
  };

  const points: Point[] = [hinge, tipClosed, tipOpen];
  for (const e of AXIS_DIRECTIONS) {
    // A degenerate (zero-length) opening makes u/v NaN; both tests fail, so
    // only the hinge and the coincident tips are contributed. No NaN escapes.
    if (e.x * u.x + e.y * u.y >= 0 && e.x * v.x + e.y * v.y >= 0) {
      points.push({ x: hinge.x + e.x * radius, y: hinge.y + e.y * radius });
    }
  }
  return points;
}

/** SVG path `d` for a door's 90° swing arc, from the closed tip to the open tip. */
export function getDoorArcPath(geometry: DoorGeometry): string {
  const { tipClosed, tipOpen, radius, sweepFlag } = geometry;
  return `M ${tipClosed.x} ${tipClosed.y} A ${radius} ${radius} 0 0 ${sweepFlag} ${tipOpen.x} ${tipOpen.y}`;
}

/**
 * Reconcile every item's `wallAttach` against its wall's current `length`:
 * clamp the opening back within the wall's bounds if it still fits, or drop
 * the item if the wall has shrunk shorter than the opening itself. Items
 * whose wall is missing (already handled at the io.ts import boundary) or
 * whose opening already fits are returned unchanged. Call this once from the
 * `commit()` chokepoint so every wall-resize path is covered uniformly.
 */
export function reconcileItemsToWalls(walls: Wall[], items: Item[]): Item[] {
  const wallsById = new Map(walls.map((w) => [w.id, w]));
  const result: Item[] = [];
  for (const item of items) {
    const wall = wallsById.get(item.wallAttach.wallId);
    if (!wall) {
      result.push(item);
      continue;
    }
    const wallLength = getWallLength(wall);
    const { offset, length } = item.wallAttach;
    if (offset >= 0 && offset + length <= wallLength) {
      result.push(item);
      continue;
    }
    if (length > wallLength) continue; // no valid position left — drop it
    const clampedOffset = Math.max(0, Math.min(offset, wallLength - length));
    result.push({
      ...item,
      wallAttach: { ...item.wallAttach, offset: clampedOffset },
    });
  }
  return result;
}
