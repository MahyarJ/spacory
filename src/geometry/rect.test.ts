import { describe, expect, it } from "vitest";
import { pointInRect, rectFrom, segmentIntersectsRect } from "./rect";

describe("rectFrom", () => {
  it("normalizes corners regardless of drag direction", () => {
    expect(rectFrom(10, 20, 0, 5)).toEqual({ x: 0, y: 5, w: 10, h: 15 });
  });
  it("produces a zero-size rect for a single point", () => {
    expect(rectFrom(3, 3, 3, 3)).toEqual({ x: 3, y: 3, w: 0, h: 0 });
  });
});

describe("pointInRect", () => {
  const r = { x: 0, y: 0, w: 10, h: 10 };
  it("is true for an interior point", () => {
    expect(pointInRect({ x: 5, y: 5 }, r)).toBe(true);
  });
  it("is true on the boundary (inclusive)", () => {
    expect(pointInRect({ x: 0, y: 10 }, r)).toBe(true);
  });
  it("is false outside", () => {
    expect(pointInRect({ x: 11, y: 5 }, r)).toBe(false);
  });
});

describe("segmentIntersectsRect", () => {
  const r = { x: 0, y: 0, w: 10, h: 10 };

  it("is true when the segment crosses the rect", () => {
    expect(segmentIntersectsRect({ x: -5, y: 5 }, { x: 15, y: 5 }, r)).toBe(
      true,
    );
  });
  it("is true when an endpoint is inside", () => {
    expect(segmentIntersectsRect({ x: 5, y: 5 }, { x: 50, y: 50 }, r)).toBe(
      true,
    );
  });
  it("is false when fully outside (quick reject)", () => {
    expect(segmentIntersectsRect({ x: -5, y: -5 }, { x: -1, y: 20 }, r)).toBe(
      false,
    );
  });
  it("is false when near but not touching", () => {
    expect(segmentIntersectsRect({ x: 11, y: 0 }, { x: 11, y: 10 }, r)).toBe(
      false,
    );
  });
});
