import { describe, expect, it } from "vitest";
import type { Wall } from "@app/schema";
import {
  findNearestWall,
  getPointOnWall,
  getWallAngle,
  getWallDirection,
  getWallLength,
  projectPointToWall,
} from "./wall";

const wall = (
  ax: number,
  ay: number,
  bx: number,
  by: number,
  thickness = 10,
  id = "w"
): Wall => ({ id, a: { x: ax, y: ay }, b: { x: bx, y: by }, thickness });

describe("getWallLength", () => {
  it("returns the euclidean length", () => {
    expect(getWallLength(wall(0, 0, 3, 4))).toBe(5);
  });
  it("is zero for a degenerate wall", () => {
    expect(getWallLength(wall(7, 7, 7, 7))).toBe(0);
  });
});

describe("getWallAngle", () => {
  it("is 0 for a rightward wall", () => {
    expect(getWallAngle(wall(0, 0, 10, 0))).toBe(0);
  });
  it("is +90deg for a downward wall", () => {
    expect(getWallAngle(wall(0, 0, 0, 10))).toBeCloseTo(Math.PI / 2);
  });
});

describe("getWallDirection", () => {
  it("returns a unit vector along the wall", () => {
    const d = getWallDirection(wall(0, 0, 3, 4));
    expect(d.x).toBeCloseTo(0.6);
    expect(d.y).toBeCloseTo(0.8);
  });
  it("does not divide by zero for a degenerate wall", () => {
    const d = getWallDirection(wall(2, 2, 2, 2));
    expect(Number.isFinite(d.x)).toBe(true);
    expect(Number.isFinite(d.y)).toBe(true);
  });
});

describe("getPointOnWall", () => {
  it("walks a given offset from endpoint a", () => {
    expect(getPointOnWall(wall(0, 0, 100, 0), 40)).toEqual({ x: 40, y: 0 });
  });
});

describe("projectPointToWall", () => {
  const w = wall(0, 0, 100, 0);

  it("projects a point above the midpoint", () => {
    const r = projectPointToWall({ x: 50, y: 10 }, w);
    expect(r.distance).toBeCloseTo(10);
    expect(r.offset).toBeCloseTo(50);
    expect(r.t).toBeCloseTo(0.5);
    expect(r.proj).toEqual({ x: 50, y: 0 });
  });

  it("clamps a point past endpoint b", () => {
    const r = projectPointToWall({ x: 150, y: 0 }, w);
    expect(r.t).toBe(1);
    expect(r.offset).toBeCloseTo(100);
    expect(r.proj).toEqual({ x: 100, y: 0 });
  });

  it("clamps a point before endpoint a", () => {
    const r = projectPointToWall({ x: -20, y: 0 }, w);
    expect(r.t).toBe(0);
    expect(r.offset).toBe(0);
    expect(r.proj).toEqual({ x: 0, y: 0 });
  });

  it("handles a degenerate (zero-length) wall", () => {
    const r = projectPointToWall({ x: 8, y: 9 }, wall(5, 5, 5, 5));
    expect(r.distance).toBeCloseTo(5); // hypot(3, 4)
    expect(r.offset).toBe(0);
    expect(r.proj).toEqual({ x: 5, y: 5 });
  });
});

describe("findNearestWall", () => {
  const a = wall(0, 0, 100, 0, 10, "a");
  const b = wall(0, 50, 100, 50, 10, "b");

  it("returns the closest wall", () => {
    const near = findNearestWall({ x: 50, y: 5 }, [a, b]);
    expect(near?.wall.id).toBe("a");
    expect(near?.distance).toBeCloseTo(5);
  });

  it("returns null when no wall is within maxDist", () => {
    expect(findNearestWall({ x: 50, y: 500 }, [a, b], 30)).toBeNull();
  });

  it("returns null for an empty wall list", () => {
    expect(findNearestWall({ x: 0, y: 0 }, [])).toBeNull();
  });
});
