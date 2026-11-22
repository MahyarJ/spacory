import type { PlanLabel } from "@app/schema";
import { ROOM_LABEL_FONT_FAMILY, ROOM_LABEL_FONT_SIZE } from "./roomLabels";

export const PLAN_LABEL_FONT_SIZE = ROOM_LABEL_FONT_SIZE;
export const PLAN_LABEL_FONT_FAMILY = ROOM_LABEL_FONT_FAMILY;
export const PLAN_LABEL_STROKE_WIDTH = 3;

export type MeasurePlanLabel = (text: string) => TextMetrics;

export function planLabelAdvance(text: string, metrics?: TextMetrics): number {
  return metrics?.width ?? Array.from(text).length * PLAN_LABEL_FONT_SIZE * 1.5;
}

export function planLabelRect(
  { position, text }: Pick<PlanLabel, "position" | "text">,
  measure?: MeasurePlanLabel,
) {
  // SVG's xml:space="preserve" keeps spaces and treats tabs as spaces.
  const metrics = measure?.(text.replaceAll("\t", " "));
  // Allow extra room for fallback fonts when no browser metrics are available.
  const width = planLabelAdvance(text, metrics);
  const pad = PLAN_LABEL_STROKE_WIDTH / 2 + 1;
  const left = Math.max(0, metrics?.actualBoundingBoxLeft ?? 0) + pad;
  const right = Math.max(width, metrics?.actualBoundingBoxRight ?? 0) + pad;
  const above =
    Math.max(PLAN_LABEL_FONT_SIZE, metrics?.actualBoundingBoxAscent ?? 0) + pad;
  const below =
    Math.max(PLAN_LABEL_FONT_SIZE / 2, metrics?.actualBoundingBoxDescent ?? 0) +
    pad;
  return {
    x: position.x - left,
    y: position.y - above,
    w: left + right,
    h: above + below,
  };
}
