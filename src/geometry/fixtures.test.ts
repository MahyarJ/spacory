import type { Fixture } from "@app/schema";
import { describe, expect, it } from "vitest";
import { getFixtureBounds, hitFixture } from "./fixtures";

const sink: Fixture = {
  id: "sink",
  type: "sink",
  position: { x: -120, y: 340 },
  width: 100,
  depth: 40,
  rotation: 30,
};

describe("rotated fixture footprints", () => {
  it("frames a non-square fixture in world space, including its stroke", () => {
    const { minX, minY, maxX, maxY } = getFixtureBounds(sink);
    expect(minX).toBeCloseTo(-120 - (25 * Math.sqrt(3) + 10) - 0.75);
    expect(maxX).toBeCloseTo(-120 + (25 * Math.sqrt(3) + 10) + 0.75);
    expect(minY).toBeCloseTo(340 - (25 + 10 * Math.sqrt(3)) - 0.75);
    expect(maxY).toBeCloseTo(340 + (25 + 10 * Math.sqrt(3)) + 0.75);
  });

  it("hit-tests the rotated rectangle within its larger axis-aligned bounds", () => {
    expect(hitFixture({ x: -85, y: 360 }, sink, 0)).toBe(true);
    expect(hitFixture({ x: -85, y: 310 }, sink, 0)).toBe(false);
    expect(hitFixture({ x: -120, y: 365 }, sink, 0)).toBe(false);
    expect(hitFixture({ x: -120, y: 365 }, sink, 5)).toBe(true);
  });
});
