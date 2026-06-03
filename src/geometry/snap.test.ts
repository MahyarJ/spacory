import { describe, expect, it } from "vitest";
import { applyInverseViewTransform, snapToGrid } from "./snap";

describe("snapToGrid", () => {
  it("rounds to the nearest grid intersection", () => {
    expect(snapToGrid({ x: 13, y: 27 }, 20)).toEqual({ x: 20, y: 20 });
    expect(snapToGrid({ x: 31, y: 9 }, 20)).toEqual({ x: 40, y: 0 });
  });
  it("leaves on-grid points unchanged", () => {
    expect(snapToGrid({ x: 40, y: -60 }, 20)).toEqual({ x: 40, y: -60 });
  });
});

describe("applyInverseViewTransform", () => {
  // Minimal stub: only getBoundingClientRect is used.
  const svg = {
    getBoundingClientRect: () => ({ left: 100, top: 50 }),
  } as unknown as SVGSVGElement;

  it("maps client coords to world coords accounting for pan/scale/offset", () => {
    // ((200 - 100) - 10) / 2 = 45 ; ((150 - 50) - 20) / 2 = 40
    expect(applyInverseViewTransform(200, 150, svg, 10, 20, 2)).toEqual({
      x: 45,
      y: 40,
    });
  });

  it("is the identity at the origin with no pan and unit scale", () => {
    expect(applyInverseViewTransform(100, 50, svg, 0, 0, 1)).toEqual({
      x: 0,
      y: 0,
    });
  });
});
