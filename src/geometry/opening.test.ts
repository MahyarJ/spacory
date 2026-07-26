import { describe, expect, it } from "vitest";
import {
  MIN_OPENING_WIDTH,
  openingPlacementFromOffsets,
  resizeOpeningWidth,
} from "./opening";

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

describe("resizeOpeningWidth", () => {
  // A 400 cm wall with an 80 cm opening starting at offset 40.
  const attach = { offset: 40, length: 80 };
  const wallLength = 400;

  it("resizes in place when the new width fits at the current offset", () => {
    expect(resizeOpeningWidth(attach, wallLength, 120)).toEqual({
      offset: 40,
      length: 120,
    });
  });

  it("clamps a below-minimum width up to MIN_OPENING_WIDTH", () => {
    expect(resizeOpeningWidth(attach, wallLength, 1)).toEqual({
      offset: 40,
      length: MIN_OPENING_WIDTH,
    });
  });

  it("keeps an exact-fit width against the far end without shifting", () => {
    // offset 40 + length 360 == wallLength 400: fits exactly, offset unchanged.
    expect(resizeOpeningWidth(attach, wallLength, 360)).toEqual({
      offset: 40,
      length: 360,
    });
  });

  it("shifts the offset back when the new width would overflow the far end", () => {
    // 380 can't start at offset 40 (40 + 380 = 420 > 400); shift back to 20.
    expect(resizeOpeningWidth(attach, wallLength, 380)).toEqual({
      offset: 20,
      length: 380,
    });
  });

  it("clamps the width to the wall length when it cannot fit even at offset 0", () => {
    expect(resizeOpeningWidth(attach, wallLength, 500)).toEqual({
      offset: 0,
      length: 400,
    });
  });

  it("honours a custom minimum width", () => {
    expect(resizeOpeningWidth(attach, wallLength, 30, 50)).toEqual({
      offset: 40,
      length: 50,
    });
  });
});
