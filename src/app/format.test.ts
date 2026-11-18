import { describe, expect, it } from "vitest";
import {
  feetAndInchesToCm,
  formatSystemArea,
  formatSystemLength,
  lengthToCm,
  toFeetAndInches,
} from "./format";

describe("system length formatting", () => {
  it.each([
    [250, "metric", "250 cm"],
    [0, "metric", "0 cm"],
    [-0.001, "metric", "0 cm"],
    [0, "imperial", "0′ 0″"],
    [2.54, "imperial", "0′ 1″"],
    [30.48, "imperial", "1′ 0″"],
    [259.08, "imperial", "8′ 6″"],
  ] as const)("formats %s cm using %s", (cm, system, expected) => {
    expect(formatSystemLength(cm, system)).toBe(expected);
  });
});

describe("system area formatting", () => {
  it.each([
    [120000, "metric", "12 m²"],
    [123456, "metric", "12.35 m²"],
    [0, "metric", "0 m²"],
    [30.48 ** 2, "imperial", "1 ft²"],
    [120000, "imperial", "129.17 ft²"],
    [0, "imperial", "0 ft²"],
  ] as const)("formats %s cm² using %s", (cm2, system, expected) => {
    expect(formatSystemArea(cm2, system)).toBe(expected);
  });
});

describe("measurement systems", () => {
  it.each([
    ["cm", 250, 250],
    ["in", 10, 25.4],
  ] as const)("converts %s input back to centimetres", (unit, value, cm) => {
    expect(lengthToCm(value, unit)).toBeCloseTo(cm);
  });

  it.each([
    0,
    2.54,
    30.48,
    259.08,
    400,
    30.48 - 0.01,
  ])("round-trips %s cm within display precision", (cm) => {
    const { feet, inches } = toFeetAndInches(cm);
    expect(inches).toBeGreaterThanOrEqual(0);
    expect(inches).toBeLessThan(12);
    expect(Math.abs(feetAndInchesToCm(feet, inches) - cm)).toBeLessThanOrEqual(
      0.127 + 1e-10,
    );
  });

  it("carries rounded inches into the next foot", () => {
    expect(toFeetAndInches(30.48 - 0.01)).toEqual({ feet: 1, inches: 0 });
    expect(formatSystemLength(259.08, "imperial")).toBe("8′ 6″");
    expect(formatSystemLength(250, "metric")).toBe("250 cm");
    expect(formatSystemArea(120000, "metric")).toBe("12 m²");
    expect(formatSystemArea(120000, "imperial")).toBe("129.17 ft²");
  });
});
