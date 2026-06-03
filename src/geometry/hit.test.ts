import { describe, expect, it } from "vitest";
import type { WindowItem, Wall } from "@app/schema";
import { distToSegment, hitItem, hitWall } from "./hit";

const wall = (
  ax: number,
  ay: number,
  bx: number,
  by: number,
  thickness = 10
): Wall => ({ id: "w", a: { x: ax, y: ay }, b: { x: bx, y: by }, thickness });

describe("distToSegment", () => {
  const a = { x: 0, y: 0 };
  const b = { x: 100, y: 0 };

  it("measures perpendicular distance over the segment body", () => {
    expect(distToSegment({ x: 50, y: 10 }, a, b)).toBeCloseTo(10);
  });
  it("measures distance to endpoint a when projection falls before it", () => {
    expect(distToSegment({ x: -3, y: 4 }, a, b)).toBeCloseTo(5);
  });
  it("measures distance to endpoint b when projection falls past it", () => {
    expect(distToSegment({ x: 103, y: 4 }, a, b)).toBeCloseTo(5);
  });
});

describe("hitWall", () => {
  const w = wall(0, 0, 100, 0, 10); // half-thickness 5, default tol 6 -> 11

  it("hits within half-thickness + tolerance", () => {
    expect(hitWall({ x: 50, y: 10 }, w)).toBe(true);
  });
  it("misses just outside the tolerance band", () => {
    expect(hitWall({ x: 50, y: 12 }, w)).toBe(false);
  });
  it("respects a custom tolerance", () => {
    expect(hitWall({ x: 50, y: 12 }, w, 8)).toBe(true);
  });
});

describe("hitItem", () => {
  // Horizontal wall; window centered at offset 50, length 20, thickness 10.
  const w = wall(0, 0, 100, 0, 10);
  const item: WindowItem = {
    id: "win",
    type: "window",
    wallAttach: { wallId: "w", offset: 40, length: 20 },
    thickness: 10,
    props: {},
  };

  it("hits at the item center", () => {
    expect(hitItem({ x: 50, y: 0 }, item, w)).toBe(true);
  });
  it("hits within the half-length + tolerance band along the wall", () => {
    // hw = 20/2 + 6 = 16
    expect(hitItem({ x: 65, y: 0 }, item, w)).toBe(true);
    expect(hitItem({ x: 67, y: 0 }, item, w)).toBe(false);
  });
  it("misses outside the cross-wall band", () => {
    // hh = 10/2 + 6 = 11
    expect(hitItem({ x: 50, y: 12 }, item, w)).toBe(false);
  });
});
