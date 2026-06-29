import {
  createInitialPlan,
  type Item,
  type Plan,
  type Wall,
} from "@app/schema";
import { describe, expect, it } from "vitest";
import { getPlanBounds } from "./bounds";

const wall = (
  ax: number,
  ay: number,
  bx: number,
  by: number,
  thickness = 10,
  id = "w",
): Wall => ({ id, a: { x: ax, y: ay }, b: { x: bx, y: by }, thickness });

const windowItem = (
  wallId: string,
  offset: number,
  length: number,
  thickness: number,
  id = "i",
): Item => ({
  id,
  type: "window",
  wallAttach: { wallId, offset, length },
  thickness,
  props: {},
});

const planOf = (walls: Wall[], items: Item[] = []): Plan => ({
  ...createInitialPlan(),
  walls,
  items,
});

describe("getPlanBounds", () => {
  it("returns null for an empty plan", () => {
    expect(getPlanBounds(planOf([]))).toBeNull();
  });

  it("frames a single wall, padded by half its thickness", () => {
    // Horizontal wall 0..100 on y=0, thickness 10 → extends ±5 around it.
    expect(getPlanBounds(planOf([wall(0, 0, 100, 0, 10)]))).toEqual({
      minX: -5,
      minY: -5,
      maxX: 105,
      maxY: 5,
    });
  });

  it("thickness widens the bounds past the centerline", () => {
    const thin = getPlanBounds(planOf([wall(0, 0, 100, 0, 4)]));
    const thick = getPlanBounds(planOf([wall(0, 0, 100, 0, 40)]));
    expect(thin).toEqual({ minX: -2, minY: -2, maxX: 102, maxY: 2 });
    expect(thick).toEqual({ minX: -20, minY: -20, maxX: 120, maxY: 20 });
  });

  it("unions multiple walls", () => {
    const bounds = getPlanBounds(
      planOf([
        wall(0, 0, 100, 0, 10, "a"),
        wall(0, 0, 0, 200, 10, "b"),
        wall(300, 300, 320, 300, 10, "c"),
      ]),
    );
    expect(bounds).toEqual({ minX: -5, minY: -5, maxX: 325, maxY: 305 });
  });

  it("expands to include items resolved through their wall", () => {
    // Item is thicker (30) than its wall (10), so it pushes the bounds out
    // perpendicular to the wall beyond what the wall alone would.
    const w = wall(0, 0, 100, 0, 10, "a");
    const item = windowItem("a", 40, 20, 30);
    expect(getPlanBounds(planOf([w], [item]))).toEqual({
      minX: -5, // wall start cap
      minY: -15, // item half-thickness dominates
      maxX: 105, // wall end cap
      maxY: 15,
    });
  });

  it("skips an item whose wall is missing", () => {
    const w = wall(0, 0, 100, 0, 10, "a");
    const orphan = windowItem("does-not-exist", 0, 20, 999);
    expect(getPlanBounds(planOf([w], [orphan]))).toEqual(
      getPlanBounds(planOf([w])),
    );
  });
});
