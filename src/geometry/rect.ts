import { Point } from "@app/schema";

const cross = (p: Point, q: Point, rp: Point) =>
  (q.x - p.x) * (rp.y - p.y) - (q.y - p.y) * (rp.x - p.x);

const segInt = (p: Point, q: Point, rp: Point, rq: Point) => {
  const d1 = cross(p, q, rp),
    d2 = cross(p, q, rq),
    d3 = cross(rp, rq, p),
    d4 = cross(rp, rq, q);
  return (
    (d1 === 0 &&
      pointInRect(rp, {
        x: Math.min(p.x, q.x),
        y: Math.min(p.y, q.y),
        w: Math.abs(p.x - q.x),
        h: Math.abs(p.y - q.y),
      })) ||
    (d2 === 0 &&
      pointInRect(rq, {
        x: Math.min(p.x, q.x),
        y: Math.min(p.y, q.y),
        w: Math.abs(p.x - q.x),
        h: Math.abs(p.y - q.y),
      })) ||
    (d1 > 0 !== d2 > 0 && d3 > 0 !== d4 > 0)
  );
};

export const rectFrom = (x0: number, y0: number, x1: number, y1: number) => ({
  x: Math.min(x0, x1),
  y: Math.min(y0, y1),
  w: Math.abs(x1 - x0),
  h: Math.abs(y1 - y0),
});

export const pointInRect = (
  p: Point,
  r: { x: number; y: number; w: number; h: number }
) => p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;

// segment/rect intersection (coarse but effective for walls)
export function segmentIntersectsRect(
  a: Point,
  b: Point,
  r: { x: number; y: number; w: number; h: number }
) {
  // quick reject
  if (
    Math.max(a.x, b.x) < r.x ||
    Math.min(a.x, b.x) > r.x + r.w ||
    Math.max(a.y, b.y) < r.y ||
    Math.min(a.y, b.y) > r.y + r.h
  )
    return false;
  // if either endpoint inside
  if (pointInRect(a, r) || pointInRect(b, r)) return true;
  // test against four edges
  const edges = [
    [
      { x: r.x, y: r.y },
      { x: r.x + r.w, y: r.y },
    ],
    [
      { x: r.x + r.w, y: r.y },
      { x: r.x + r.w, y: r.y + r.h },
    ],
    [
      { x: r.x + r.w, y: r.y + r.h },
      { x: r.x, y: r.y + r.h },
    ],
    [
      { x: r.x, y: r.y + r.h },
      { x: r.x, y: r.y },
    ],
  ];
  return edges.some(([p, q]) => segInt(a, b, p, q));
}
