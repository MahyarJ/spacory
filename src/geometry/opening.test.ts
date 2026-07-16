import { describe, expect, it } from "vitest";
import { MIN_OPENING_WIDTH, openingPlacementFromOffsets } from "./opening";

describe("openingPlacementFromOffsets", () => {
  it("uses the lower offset as start and the span as length", () => {
    expect(openingPlacementFromOffsets(40, 120)).toEqual({
      offset: 40,
      length: 80,
    });
  });

  it("is direction-agnostic (dragging backwards yields the same placement)", () => {
    expect(openingPlacementFromOffsets(120, 40)).toEqual(
      openingPlacementFromOffsets(40, 120),
    );
  });

  it("returns null when the span is below the minimum width", () => {
    expect(openingPlacementFromOffsets(100, 100)).toBeNull();
    expect(
      openingPlacementFromOffsets(100, 100 + MIN_OPENING_WIDTH - 1),
    ).toBeNull();
  });

  it("keeps an opening exactly at the minimum width", () => {
    expect(openingPlacementFromOffsets(100, 100 + MIN_OPENING_WIDTH)).toEqual({
      offset: 100,
      length: MIN_OPENING_WIDTH,
    });
  });

  it("honours a custom minimum width", () => {
    expect(openingPlacementFromOffsets(0, 20, 50)).toBeNull();
    expect(openingPlacementFromOffsets(0, 60, 50)).toEqual({
      offset: 0,
      length: 60,
    });
  });
});
