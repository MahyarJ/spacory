import type { Point, Wall } from "@app/schema";

// Coordinates are grid-snapped cm values; a tiny epsilon absorbs float noise
// while still treating "shared coordinate" as exact equality (per the data
// model: two walls are connected iff an endpoint coordinate matches exactly).
const EPS = 1e-6;

export function pointsEqual(a: Point, b: Point, eps = EPS): boolean {
  return Math.abs(a.x - b.x) < eps && Math.abs(a.y - b.y) < eps;
}

export interface WallEndpointRef {
  wallId: string;
  end: "a" | "b";
}

/** Every wall endpoint that sits at `point` (within a small epsilon). */
export function findConnectedEndpoints(
  walls: Wall[],
  point: Point,
  eps = EPS,
): WallEndpointRef[] {
  const refs: WallEndpointRef[] = [];
  for (const w of walls) {
    if (pointsEqual(w.a, point, eps)) refs.push({ wallId: w.id, end: "a" });
    if (pointsEqual(w.b, point, eps)) refs.push({ wallId: w.id, end: "b" });
  }
  return refs;
}

/** Every distinct coordinate where at least one wall endpoint sits. */
export function getConnectionPoints(walls: Wall[], eps = EPS): Point[] {
  const points: Point[] = [];
  for (const w of walls) {
    if (!points.some((p) => pointsEqual(p, w.a, eps))) points.push(w.a);
    if (!points.some((p) => pointsEqual(p, w.b, eps))) points.push(w.b);
  }
  return points;
}

/**
 * Move every wall endpoint that sits at `point` by (dx, dy) — a corner/junction
 * drag. Pure: returns a new array; walls untouched by the move keep their
 * original object identity.
 */
export function translateEndpointsAt(
  walls: Wall[],
  point: Point,
  dx: number,
  dy: number,
  eps = EPS,
): Wall[] {
  if (dx === 0 && dy === 0) return walls;
  return walls.map((w) => {
    const atA = pointsEqual(w.a, point, eps);
    const atB = pointsEqual(w.b, point, eps);
    if (!atA && !atB) return w;
    return {
      ...w,
      a: atA ? { x: w.a.x + dx, y: w.a.y + dy } : w.a,
      b: atB ? { x: w.b.x + dx, y: w.b.y + dy } : w.b,
    };
  });
}

/**
 * Move exactly the given wall endpoints by (dx, dy) — a fixed-membership
 * junction drag. Unlike `translateEndpointsAt`, membership isn't re-derived
 * from the live coordinate on each call, so transiting over an unrelated
 * junction's coordinate mid-drag can't pull its endpoints along. Pure: walls
 * untouched by the move keep their original object identity.
 */
export function translateEndpoints(
  walls: Wall[],
  refs: WallEndpointRef[],
  dx: number,
  dy: number,
): Wall[] {
  if ((dx === 0 && dy === 0) || refs.length === 0) return walls;
  const endsByWall = new Map<string, Set<WallEndpointRef["end"]>>();
  for (const ref of refs) {
    const ends = endsByWall.get(ref.wallId) ?? new Set();
    ends.add(ref.end);
    endsByWall.set(ref.wallId, ends);
  }
  return walls.map((w) => {
    const ends = endsByWall.get(w.id);
    if (!ends) return w;
    return {
      ...w,
      a: ends.has("a") ? { x: w.a.x + dx, y: w.a.y + dy } : w.a,
      b: ends.has("b") ? { x: w.b.x + dx, y: w.b.y + dy } : w.b,
    };
  });
}
