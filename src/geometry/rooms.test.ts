import type { Point, Wall } from "@app/schema";
import { describe, expect, it } from "vitest";
import { detectRooms } from "./rooms";

function boundary(points: number[][], prefix = "w"): Wall[] {
  return points.map(([x, y], i) => {
    const next = points[(i + 1) % points.length];
    return {
      id: `${prefix}${i}`,
      a: { x, y },
      b: { x: next[0], y: next[1] },
      thickness: 10,
    };
  });
}
const rectangle = () =>
  boundary([
    [0, 0],
    [400, 0],
    [400, 300],
    [0, 300],
  ]);
function inside(p: Point, polygon: Point[]): boolean {
  let result = false;
  for (let i = 1; i < polygon.length; i++) {
    const a = polygon[i - 1];
    const b = polygon[i];
    if (
      a.y > p.y !== b.y > p.y &&
      p.x < a.x + ((p.y - a.y) * (b.x - a.x)) / (b.y - a.y)
    )
      result = !result;
  }
  return result;
}

describe("detectRooms", () => {
  it("returns a closed rectangle with centreline area and an interior label", () => {
    const walls = rectangle();
    const original = JSON.stringify(walls);
    const rooms = detectRooms(walls);
    expect(rooms).toHaveLength(1);
    expect(rooms[0].area).toBe(120000);
    expect(rooms[0].polygon[0]).toEqual(rooms[0].polygon.at(-1));
    expect(rooms[0].labelPoint).toEqual({ x: 200, y: 150 });
    expect(JSON.stringify(walls)).toBe(original);
  });

  it("centres labels in rectangles even when their sides have extra junctions", () => {
    const room = detectRooms(
      boundary([
        [0, 0],
        [400, 0],
        [400, 100],
        [400, 300],
        [0, 300],
      ]),
    )[0];
    expect(room.labelPoint).toEqual({ x: 200, y: 150 });
  });

  it("uses the area centroid of a sloped room", () => {
    const room = detectRooms(
      boundary([
        [0, 0],
        [600, 0],
        [0, 300],
      ]),
    )[0];
    expect(room.labelPoint.x).toBeCloseTo(200);
    expect(room.labelPoint.y).toBeCloseTo(100);
    expect(inside(room.labelPoint, room.polygon)).toBe(true);
  });

  it("keeps centering stable when a room is rotated and translated", () => {
    const room = detectRooms(
      boundary([
        [0, 0],
        [400, 0],
        [400, 300],
        [0, 300],
      ]).map((w) => {
        const transform = (p: Point) => ({
          x: 1e8 + (p.x - p.y) / Math.SQRT2,
          y: 1e8 + (p.x + p.y) / Math.SQRT2,
        });
        return { ...w, a: transform(w.a), b: transform(w.b) };
      }),
    )[0];
    expect(room.labelPoint.x).toBeCloseTo(1e8 + 50 / Math.SQRT2);
    expect(room.labelPoint.y).toBeCloseTo(1e8 + 350 / Math.SQRT2);
  });

  it("does not depend on wall direction or input order", () => {
    const walls = rectangle()
      .reverse()
      .map((w) => ({ ...w, a: w.b, b: w.a }));
    expect(detectRooms(walls).map((r) => r.area)).toEqual([120000]);
  });

  it("places a label inside a concave L whose centroid lies outside", () => {
    const rooms = detectRooms(
      boundary([
        [0, 0],
        [600, 0],
        [600, 100],
        [100, 100],
        [100, 600],
        [0, 600],
      ]),
    );
    expect(rooms).toHaveLength(1);
    expect(rooms[0].area).toBe(110000);
    expect(inside(rooms[0].labelPoint, rooms[0].polygon)).toBe(true);
  });

  it("finds adjacent rooms sharing a split boundary", () => {
    const walls = boundary([
      [0, 0],
      [200, 0],
      [400, 0],
      [400, 300],
      [200, 300],
      [0, 300],
    ]);
    walls.push({
      id: "divider",
      a: { x: 200, y: 0 },
      b: { x: 200, y: 300 },
      thickness: 10,
    });
    expect(detectRooms(walls).map((r) => r.area)).toEqual([60000, 60000]);
  });

  it("handles disconnected rooms and rooms touching at one vertex", () => {
    for (const offset of [400, 800]) {
      const second = rectangle().map((w) => ({
        ...w,
        id: `b${w.id}`,
        a: { x: w.a.x + offset, y: w.a.y + 300 },
        b: { x: w.b.x + offset, y: w.b.y + 300 },
      }));
      expect(
        detectRooms([...rectangle(), ...second]).map((r) => r.area),
      ).toEqual([120000, 120000]);
    }
  });

  it("ignores dangling spurs both inside and outside a room", () => {
    for (const x of [100, -100]) {
      const spur: Wall = {
        id: "spur",
        a: { x: 0, y: 0 },
        b: { x, y: 100 },
        thickness: 10,
      };
      const rooms = detectRooms([...rectangle(), spur]);
      expect(rooms).toHaveLength(1);
      expect(rooms[0].area).toBe(120000);
      expect(rooms[0].polygon).toHaveLength(5);
    }
  });

  it("returns no rooms for empty, single-wall, open, and collinear plans", () => {
    expect(detectRooms([])).toEqual([]);
    expect(detectRooms(rectangle().slice(0, 1))).toEqual([]);
    expect(detectRooms(rectangle().slice(0, 3))).toEqual([]);
    expect(
      detectRooms(
        boundary([
          [0, 0],
          [100, 0],
          [200, 0],
        ]),
      ),
    ).toEqual([]);
    const gap = rectangle();
    gap[0].a.x += 0.01;
    expect(detectRooms(gap)).toEqual([]);
  });

  it("matches endpoint float noise across spatial bucket boundaries", () => {
    const walls = rectangle();
    walls[0].a.x -= 0.0000001;
    expect(detectRooms(walls)).toHaveLength(1);
  });

  it("ignores duplicates, zero-length and non-finite edges without crashing", () => {
    const walls = rectangle();
    walls.push({ ...walls[0], id: "duplicate", a: walls[0].b, b: walls[0].a });
    walls.push({ ...walls[0], id: "zero", b: walls[0].a });
    walls.push({ ...walls[0], id: "invalid", a: { x: Number.NaN, y: 0 } });
    expect(detectRooms(walls).map((r) => r.area)).toEqual([120000]);
    expect(() =>
      detectRooms(
        boundary([
          [0, 0],
          [100, 100],
          [0, 100],
          [100, 0],
        ]),
      ),
    ).not.toThrow();
  });

  it("keeps area precision on plans far from the origin", () => {
    const walls = rectangle().map((w) => ({
      ...w,
      a: { x: w.a.x + 1e8, y: w.a.y + 1e8 },
      b: { x: w.b.x + 1e8, y: w.b.y + 1e8 },
    }));
    expect(detectRooms(walls)[0].area).toBe(120000);
  });

  it("detects a house-scale grid without losing shared faces", () => {
    const walls: Wall[] = [];
    for (let y = 0; y <= 20; y++) {
      for (let x = 0; x <= 20; x++) {
        const a = { x: x * 300, y: y * 300 };
        if (x < 20)
          walls.push({
            id: `h${x},${y}`,
            a,
            b: { x: a.x + 300, y: a.y },
            thickness: 10,
          });
        if (y < 20)
          walls.push({
            id: `v${x},${y}`,
            a,
            b: { x: a.x, y: a.y + 300 },
            thickness: 10,
          });
      }
    }
    const rooms = detectRooms(walls);
    expect(rooms).toHaveLength(400);
    expect(
      rooms.every((r) => r.area === 90000 && inside(r.labelPoint, r.polygon)),
    ).toBe(true);
  });
});
