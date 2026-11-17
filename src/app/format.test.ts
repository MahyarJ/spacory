import { describe, expect, it } from "vitest";
import { formatArea, formatLength } from "./format";

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
