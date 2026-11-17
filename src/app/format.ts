import type { MeasurementSystem, Units } from "@app/schema";

/**
 * Pure, unit-aware formatting of measured lengths.
 *
 * Internal coordinates are always plain cm numbers (see schema). This module
 * converts a cm length into the plan's configured display unit and renders it
 * as a short, human-readable string. It does not touch coordinates — callers
 * keep cm everywhere and only format at the point of display.
 */

/** How many centimetres make up one of each unit. */
const CM_PER_UNIT: Record<Units, number> = {
  mm: 0.1,
  cm: 1,
  m: 100,
  in: 2.54,
  ft: 30.48,
};

/** Decimal places to round to per unit, chosen for readable plan-scale values. */
const DECIMALS: Record<Units, number> = {
  mm: 0,
  cm: 0,
  m: 2,
  in: 1,
  ft: 2,
};

/**
 * Format a length given in centimetres for display in the given unit.
 *
 * The value is converted to `units`, rounded to a sensible precision for that
 * unit, and suffixed with the unit symbol (e.g. `250` cm → `"250 cm"`,
 * `"2.5 m"`). Trailing zeros from rounding are dropped so `100 cm` reads as
 * `"1 m"`, not `"1.00 m"`.
 */
export function formatLength(lengthCm: number, units: Units): string {
  const value = lengthCm / CM_PER_UNIT[units];
  const rounded = Number(value.toFixed(DECIMALS[units]));
  // `Number(...)` drops trailing zeros; `|| 0` normalises a possible `-0`.
  return `${rounded || 0} ${units}`;
}

/** Format a centreline area supplied in cm², converting by the squared unit factor. */
export function formatArea(areaCm2: number, units: Units): string {
  const value = areaCm2 / CM_PER_UNIT[units] ** 2;
  const rounded = Number(value.toFixed(DECIMALS[units]));
  return `${rounded || 0} ${units}²`;
}

/** Convert a numeric length to internal centimetres. */
export function lengthToCm(value: number, units: Units): number {
  return value * CM_PER_UNIT[units];
}

/** Round to tenths of an inch before splitting, carrying 12 inches into feet. */
export function toFeetAndInches(lengthCm: number): {
  feet: number;
  inches: number;
} {
  const tenths = Math.round((lengthCm / CM_PER_UNIT.in) * 10);
  return { feet: Math.floor(tenths / 120), inches: (tenths % 120) / 10 };
}

export function feetAndInchesToCm(feet: number, inches: number): number {
  return lengthToCm(feet * 12 + inches, "in");
}

export function formatSystemLength(
  lengthCm: number,
  system: MeasurementSystem,
): string {
  if (system === "metric") return formatLength(lengthCm, "cm");
  const { feet, inches } = toFeetAndInches(lengthCm);
  return `${feet}′ ${inches}″`;
}

export function formatSystemArea(
  areaCm2: number,
  system: MeasurementSystem,
): string {
  return formatArea(areaCm2, system === "metric" ? "m" : "ft");
}
