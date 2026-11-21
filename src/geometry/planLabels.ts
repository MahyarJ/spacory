import type { PlanLabel } from "@app/schema";

export const PLAN_LABEL_FONT_SIZE = 18;
export const PLAN_LABEL_FONT_FAMILY = "sans-serif";
export const PLAN_LABEL_STROKE_WIDTH = 3;

export type MeasurePlanLabel = (text: string) => TextMetrics;

/** Label positions are centered horizontally on the text's alphabetic baseline. */
export function planLabelRect(
  { position, text }: PlanLabel,
  measure?: MeasurePlanLabel,
) {
  // SVG's xml:space="preserve" keeps spaces and treats tabs as spaces.
  const metrics = measure?.(text.replaceAll("\t", " "));
  // Allow extra room for fallback fonts when no browser metrics are available.
  const halfWidth =
    (metrics?.width ?? Array.from(text).length * PLAN_LABEL_FONT_SIZE * 1.5) /
    2;
  const pad = PLAN_LABEL_STROKE_WIDTH / 2 + 1;
  const left = Math.max(halfWidth, metrics?.actualBoundingBoxLeft ?? 0) + pad;
  const right = Math.max(halfWidth, metrics?.actualBoundingBoxRight ?? 0) + pad;
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
