import {
  createInitialPlan,
  type DoorItem,
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

const doorItem = (
  wallId: string,
  offset: number,
  length: number,
  thickness: number,
  props: DoorItem["props"],
  id = "d",
): Item => ({
  id,
  type: "door",
  wallAttach: { wallId, offset, length },
  thickness,
  props,
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

  it("leaves the bounds untouched for a window inside its wall's thickness", () => {
    // A window's rect and midline stay within half its own thickness of the
    // wall centerline, so a window no thicker than its wall adds no extent.
    const w = wall(0, 0, 100, 0, 20, "a");
    const item = windowItem("a", 40, 20, 10);
    expect(getPlanBounds(planOf([w], [item]))).toEqual(
      getPlanBounds(planOf([w])),
    );
  });

  it("includes a door's full swing arc, on the side it swings", () => {
    // Wall 0..400 thickness 10; door at offset 100, length 80 (= arc radius),
    // hinged at the "end" edge and swinging to -y. The arc reaches y = -80.
    const w = wall(0, 0, 400, 0, 10, "a");
    const door = doorItem("a", 100, 80, 10, {
      hingeEdge: "end",
      swingSide: "outside",
    });
    expect(getPlanBounds(planOf([w], [door]))).toEqual({
      minX: -5, // wall start cap — the arc doesn't reach past it
      minY: -80, // the open tip of the leaf
      maxX: 405, // wall end cap
      maxY: 5, // unchanged: nothing is drawn on the +y side
    });
  });

  it("mirrors the arc for the other hinge edge and the other swing side", () => {
    const w = wall(0, 0, 400, 0, 10, "a");
    const box = (props: DoorItem["props"]) =>
      getPlanBounds(planOf([w], [doorItem("a", 100, 80, 10, props)]));

    // Hinge edge moves the arc along the wall but not off the swept side.
    expect(box({ hingeEdge: "start", swingSide: "outside" })).toEqual({
      minX: -5,
      minY: -80,
      maxX: 405,
      maxY: 5,
    });
    // Swinging "inside" flips the arc to +y instead.
    expect(box({ hingeEdge: "end", swingSide: "inside" })).toEqual({
      minX: -5,
      minY: -5,
      maxX: 405,
      maxY: 80,
    });
    expect(box({ hingeEdge: "start", swingSide: "inside" })).toEqual({
      minX: -5,
      minY: -5,
      maxX: 405,
      maxY: 80,
    });
  });

  it("includes the arc's bulge on a 45° wall, where it is not one side of the box", () => {
    // 45° wall (0,0)..(60,60); door at offset 20, length 60, swinging outward.
    // The arc's rightmost point is the circle's +x extreme (hinge.x + radius),
    // which is neither tip — and it is what sets maxX.
    const w = wall(0, 0, 60, 60, 10, "a");
    const door = doorItem("a", 20, 60, 18, {
      hingeEdge: "start",
      swingSide: "outside",
    });
    const bounds = getPlanBounds(planOf([w], [door]));
    expect(bounds?.minX).toBeCloseTo(-5); // wall start cap
    expect(bounds?.minY).toBeCloseTo(-28.2842712); // the open tip
    expect(bounds?.maxX).toBeCloseTo(74.1421356); // hinge.x + radius, not a tip
    expect(bounds?.maxY).toBeCloseTo(65.5685425); // opening's far edge, padded
  });

  it("skips an item whose wall is missing", () => {
    const w = wall(0, 0, 100, 0, 10, "a");
    const orphan = windowItem("does-not-exist", 0, 20, 999);
    expect(getPlanBounds(planOf([w], [orphan]))).toEqual(
      getPlanBounds(planOf([w])),
    );
  });
});
