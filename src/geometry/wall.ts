import type { Point, Wall } from "@app/schema";

export function getWallLength(w: Wall): number {
  const dx = w.b.x - w.a.x,
    dy = w.b.y - w.a.y;
  return Math.hypot(dx, dy);
}

export function getWallAngle(w: Wall): number {
  return Math.atan2(w.b.y - w.a.y, w.b.x - w.a.x);
}

export function getWallDirection(w: Wall): Point {
  const len = getWallLength(w) || 1;
  return { x: (w.b.x - w.a.x) / len, y: (w.b.y - w.a.y) / len };
}

export function getPointOnWall(w: Wall, offset: number): Point {
  const dir = getWallDirection(w);
  return {
    x: w.a.x + dir.x * offset,
    y: w.a.y + dir.y * offset,
  };
}

/** Distance from point to segment + projected offset (clamped) */
export function projectPointToWall(p: Point, w: Wall) {
  const ax = w.a.x,
    ay = w.a.y,
    bx = w.b.x,
    by = w.b.y;
  const dx = bx - ax,
    dy = by - ay;
  const len2 = dx * dx + dy * dy;
  if (!len2)
    return {
      distance: Math.hypot(p.x - ax, p.y - ay),
      offset: 0,
      t: 0,
      proj: { x: ax, y: ay },
    };
  const tRaw = ((p.x - ax) * dx + (p.y - ay) * dy) / len2;
  const t = Math.max(0, Math.min(1, tRaw));
  const px = ax + t * dx,
    py = ay + t * dy;
  const offset = getWallLength(w) * t;
  const distance = Math.hypot(p.x - px, p.y - py);
  return { distance, offset, t, proj: { x: px, y: py } };
}

/** Find nearest wall by perpendicular distance (optionally with a max threshold) */
export function findNearestWall(p: Point, walls: Wall[], maxDist = 30) {
  let best: { wall: Wall; distance: number; offset: number } | null = null;
  for (const w of walls) {
    const { distance, offset } = projectPointToWall(p, w);
    if (best === null || distance < best.distance) {
      best = { wall: w, distance, offset };
    }
  }
  if (!best) return null;
  return best.distance <= maxDist ? best : null;
}
