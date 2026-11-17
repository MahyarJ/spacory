import { lengthToCm } from "./format";
import type { MeasurementSystem } from "./schema";

export type ThicknessPreset = "standard" | "thick";

export const THICKNESS_PRESETS = {
  metric: [
    { id: "standard", cm: 10, label: "10 cm" },
    { id: "thick", cm: 15, label: "15 cm" },
  ],
  imperial: [
    { id: "standard", cm: lengthToCm(4.5, "in"), label: "4½″" },
    { id: "thick", cm: lengthToCm(6.5, "in"), label: "6½″" },
  ],
} as const;

/** Preset identity survives unit changes; custom measurements retain their cm value. */
export function drawingThickness(
  system: MeasurementSystem,
  preset: ThicknessPreset | null,
  customCm: number,
): number {
  return preset === null
    ? customCm
    : THICKNESS_PRESETS[system].find((p) => p.id === preset)!.cm;
}
