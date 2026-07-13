import type { DoorItem, Wall, WindowItem } from "@app/schema";
import { describe, expect, it } from "vitest";
import {
  getDoorArcPath,
  getDoorGeometry,
  getWindowGeometry,
  reconcileItemsToWalls,
} from "./itemGeometry";

const wall = (ax: number, ay: number, bx: number, by: number): Wall => ({
  id: "w",
  a: { x: ax, y: ay },
  b: { x: bx, y: by },
  thickness: 10,
});

const doorItem = (
  hingeEdge: DoorItem["props"]["hingeEdge"],
  swingSide: DoorItem["props"]["swingSide"],
): DoorItem => ({
  id: "d",
  type: "door",
  wallAttach: { wallId: "w", offset: 40, length: 20 },
  thickness: 18,
  props: { hingeEdge, swingSide },
});

const windowItem = (): WindowItem => ({
  id: "win",
  type: "window",
  wallAttach: { wallId: "w", offset: 40, length: 20 },
  thickness: 18,
  props: {},
});

describe("getWindowGeometry", () => {
  it("centers the opening rect on the wall segment, rotated to the wall's angle", () => {
    const { rect, midline } = getWindowGeometry(
      windowItem(),
      wall(0, 0, 100, 0),
    );
    expect(rect).toEqual({
      x: 40,
      y: -9,
      width: 20,
      height: 18,
      angleDeg: 0,
      cx: 50,
      cy: 0,
    });
    expect(midline).toEqual({ x1: 40, y1: 0, x2: 60, y2: 0 });
  });

  it("reports the wall's angle for a rotated wall", () => {
    const { rect } = getWindowGeometry(windowItem(), wall(0, 0, 0, 100));
    expect(rect.angleDeg).toBeCloseTo(90);
  });
});

describe("getDoorGeometry", () => {
  it("places the hinge at the 'end' edge when hingeEdge is 'end'", () => {
    const geometry = getDoorGeometry(
      doorItem("end", "outside"),
      wall(0, 0, 100, 0),
    );
    // opening spans x=40..60 centered at (50,0); "end" hinge -> +x side
    expect(geometry.hinge).toEqual({ x: 60, y: 0 });
    expect(geometry.tipClosed).toEqual({ x: 40, y: 0 });
  });

  it("places the hinge at the 'start' edge when hingeEdge is 'start'", () => {
    const geometry = getDoorGeometry(
      doorItem("start", "outside"),
      wall(0, 0, 100, 0),
    );
    expect(geometry.hinge).toEqual({ x: 40, y: 0 });
    expect(geometry.tipClosed).toEqual({ x: 60, y: 0 });
  });

  it("swings the open tip to the outside vs. inside normal", () => {
    const outside = getDoorGeometry(
      doorItem("end", "outside"),
      wall(0, 0, 100, 0),
    );
    const inside = getDoorGeometry(
      doorItem("end", "inside"),
      wall(0, 0, 100, 0),
    );
    // normal of a horizontal +x wall is (0, 1); outside = -normal, inside = +normal
    expect(outside.tipOpen).toEqual({ x: 60, y: -20 });
    expect(inside.tipOpen).toEqual({ x: 60, y: 20 });
  });

  it("builds an SVG arc path from the closed tip to the open tip", () => {
    const geometry = getDoorGeometry(
      doorItem("end", "outside"),
      wall(0, 0, 100, 0),
    );
    expect(getDoorArcPath(geometry)).toBe(
      `M 40 0 A 20 20 0 0 ${geometry.sweepFlag} 60 -20`,
    );
  });
});

describe("reconcileItemsToWalls", () => {
  it("clamps an opening back onto a shrunk wall, preserving its length", () => {
    const walls = [wall(0, 0, 50, 0)];
    const items = [windowItem()]; // offset 40, length 20 -> spans 40..60, wall is now 0..50
    const [result] = reconcileItemsToWalls(walls, items);
    expect(result.wallAttach).toEqual({ wallId: "w", offset: 30, length: 20 });
  });

  it("removes an item whose own length no longer fits the shrunk wall", () => {
    const walls = [wall(0, 0, 10, 0)]; // shorter than the window's own 20cm length
    const items = [windowItem()];
    expect(reconcileItemsToWalls(walls, items)).toEqual([]);
  });

  it("leaves an item unchanged when its opening already fits", () => {
    const walls = [wall(0, 0, 100, 0)];
    const items = [windowItem()]; // offset 40, length 20 -> fits within 0..100
    const [result] = reconcileItemsToWalls(walls, items);
    expect(result).toBe(items[0]);
  });

  it("leaves an item unchanged when its wall no longer exists", () => {
    const items = [windowItem()];
    expect(reconcileItemsToWalls([], items)).toEqual(items);
  });
});
