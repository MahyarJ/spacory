import { describe, expect, it } from "vitest";
import {
  feetAndInchesToCm,
  formatArea,
  formatLength,
  formatSystemArea,
  formatSystemLength,
  lengthToCm,
  toFeetAndInches,
} from "./format";

describe("formatLength", () => {
  it("formats cm as a whole number with the unit", () => {
    expect(formatLength(250, "cm")).toBe("250 cm");
  });

  it("converts cm to metres", () => {
    expect(formatLength(250, "m")).toBe("2.5 m");
  });

  it("drops trailing zeros so a round value reads cleanly", () => {
    expect(formatLength(100, "m")).toBe("1 m");
  });

  it("converts cm to millimetres", () => {
    expect(formatLength(2.5, "mm")).toBe("25 mm");
  });

  it("converts cm to inches, rounded to one decimal", () => {
    expect(formatLength(100, "in")).toBe("39.4 in");
  });

  it("formats an exact inch without decimals after rounding", () => {
    expect(formatLength(2.54, "in")).toBe("1 in");
  });

  it("converts cm to feet, rounded to two decimals", () => {
    expect(formatLength(30.48, "ft")).toBe("1 ft");
  });

  it("formats zero length", () => {
    expect(formatLength(0, "cm")).toBe("0 cm");
  });

  it("does not emit negative zero from rounding", () => {
    expect(formatLength(-0.001, "cm")).toBe("0 cm");
  });
});

describe("formatArea", () => {
  it.each([
    [120000, "cm", "120000 cm²"],
    [120000, "m", "12 m²"],
    [1, "mm", "100 mm²"],
    [2.54 ** 2, "in", "1 in²"],
    [30.48 ** 2, "ft", "1 ft²"],
    [123456, "m", "12.35 m²"],
    [0, "m", "0 m²"],
  ] as const)("formats %s cm² as %s", (area, units, expected) => {
    expect(formatArea(area, units)).toBe(expected);
  });
});

describe("measurement systems", () => {
  it.each([
    ["cm", 250, 250],
    ["m", 2.5, 250],
    ["mm", 2500, 250],
    ["in", 10, 25.4],
    ["ft", 10, 304.8],
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
