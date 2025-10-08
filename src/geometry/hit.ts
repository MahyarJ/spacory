import type { Point, Wall, Item } from "@app/schema";
import { getWallDirection, getPointOnWall, getWallAngle } from "./wall";

export function distToSegment(p: Point, a: Point, b: Point) {
  const vx = b.x - a.x,
    vy = b.y - a.y;
  const wx = p.x - a.x,
    wy = p.y - a.y;
  const c1 = vx * wx + vy * wy;
  if (c1 <= 0) return Math.hypot(p.x - a.x, p.y - a.y);
  const c2 = vx * vx + vy * vy;
  if (c2 <= c1) return Math.hypot(p.x - b.x, p.y - b.y);
  const t = c1 / c2;
  const proj = { x: a.x + t * vx, y: a.y + t * vy };
  return Math.hypot(p.x - proj.x, p.y - proj.y);
}

export function hitWall(p: Point, wall: Wall, tolerance = 6) {
  // Treat wall as centerline + half thickness; accept hit if within halfThickness + tolerance
  const d = distToSegment(p, wall.a, wall.b);
  return d <= wall.thickness / 2 + tolerance;
}

export function hitItem(p: Point, item: Item, wall: Wall, tolerance = 6) {
  // Transform point to the wall’s local space: X along wall, Y across wall
  const dir = getWallDirection(wall);
  const angle = getWallAngle(wall);
  const cos = Math.cos(-angle),
    sin = Math.sin(-angle);

  const centerOffset = item.wallAttach.offset + item.wallAttach.length / 2;
  const c = getPointOnWall(wall, centerOffset);

  // translate to rect center, then rotate inverse
  const dx = p.x - c.x,
    dy = p.y - c.y;
  const lx = dx * cos - dy * sin;
  const ly = dx * sin + dy * cos;

  const hw = item.wallAttach.length / 2 + tolerance;
  const hh = item.thickness / 2 + tolerance;
  return Math.abs(lx) <= hw && Math.abs(ly) <= hh;
}
