import { describe, expect, it } from "vitest";
import type { Wall } from "@app/schema";
import { computeJunctionPivot } from "./joint";

const wall = (
  ax: number,
  ay: number,
  bx: number,
  by: number,
  thickness: number,
  id = "w"
): Wall => ({ id, a: { x: ax, y: ay }, b: { x: bx, y: by }, thickness });

describe("computeJunctionPivot", () => {
  it("finds the inner corner of two perpendicular walls (equal thickness)", () => {
    const w1 = wall(0, 0, 100, 0, 10, "h"); // rightward
    const w2 = wall(0, 0, 0, 100, 10, "v"); // downward
    const pivot = computeJunctionPivot(w1, "A", w2, "A", { x: 0, y: 0 });
    expect(pivot).not.toBeNull();
    expect(pivot!.x).toBeCloseTo(5);
    expect(pivot!.y).toBeCloseTo(5);
  });

  it("accounts for differing wall thicknesses", () => {
    const w1 = wall(0, 0, 100, 0, 20, "h"); // half-thickness 10
    const w2 = wall(0, 0, 0, 100, 10, "v"); // half-thickness 5
    const pivot = computeJunctionPivot(w1, "A", w2, "A", { x: 0, y: 0 });
    expect(pivot!.x).toBeCloseTo(5);
    expect(pivot!.y).toBeCloseTo(10);
  });

  it("returns null for parallel walls (no unique intersection)", () => {
    const w1 = wall(0, 0, 100, 0, 10, "a");
    const w2 = wall(0, 0, 100, 0, 10, "b");
    expect(computeJunctionPivot(w1, "A", w2, "A", { x: 0, y: 0 })).toBeNull();
  });
});
