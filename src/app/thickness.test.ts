import { describe, expect, it } from "vitest";
import { drawingThickness } from "./thickness";

describe("drawing thickness", () => {
  it.each([
    ["metric", "standard", 10],
    ["metric", "thick", 15],
    ["metric", "heavy", 30],
    ["imperial", "standard", 11.43],
    ["imperial", "thick", 16.51],
    ["imperial", "heavy", 30.48],
  ] as const)("maps %s %s to its construction preset", (system, preset, cm) => {
    expect(drawingThickness(system, preset, 99)).toBeCloseTo(cm);
  });
  it("preserves exact custom dimensions in both systems", () => {
    expect(drawingThickness("metric", null, 10.123456)).toBe(10.123456);
    expect(drawingThickness("imperial", null, 10.123456)).toBe(10.123456);
  });
});
