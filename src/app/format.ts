import type { MeasurementSystem } from "@app/schema";

/** Units accepted by the numeric length and thickness editors. */
export type LengthUnit = "cm" | "in";

const CM_PER_INCH = 2.54;
const CM_PER_UNIT: Record<LengthUnit, number> = { cm: 1, in: CM_PER_INCH };

/** Coordinates always stay in cm; formatting follows the plan's measurement system. */
/** Convert a numeric length to internal centimetres. */
export function lengthToCm(value: number, units: LengthUnit): number {
  return value * CM_PER_UNIT[units];
}

/** Round to tenths of an inch before splitting, carrying 12 inches into feet. */
export function toFeetAndInches(lengthCm: number): {
  feet: number;
  inches: number;
} {
  const tenths = Math.round((lengthCm / CM_PER_INCH) * 10);
  return { feet: Math.floor(tenths / 120), inches: (tenths % 120) / 10 };
}

export function feetAndInchesToCm(feet: number, inches: number): number {
  return lengthToCm(feet * 12 + inches, "in");
}

export function formatSystemLength(
  lengthCm: number,
  system: MeasurementSystem,
): string {
  if (system === "metric") return `${Number(lengthCm.toFixed(0)) || 0} cm`;
  const { feet, inches } = toFeetAndInches(lengthCm);
  return `${feet}′ ${inches}″`;
}

export function formatSystemArea(
  areaCm2: number,
  system: MeasurementSystem,
): string {
  const metric = system === "metric";
  const cmPerUnit = metric ? 100 : CM_PER_INCH * 12;
  const rounded = Number((areaCm2 / cmPerUnit ** 2).toFixed(2)) || 0;
  return `${rounded} ${metric ? "m²" : "ft²"}`;
}
