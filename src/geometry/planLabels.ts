import type { PlanLabel } from "@app/schema";
import { MIN_SCALE } from "@app/viewport";

export const PLAN_LABEL_FONT_SIZE = 30;
export const MIN_PLAN_LABEL_SCREEN_SIZE = 16;
export const PLAN_LABEL_FONT_FAMILY = "sans-serif";
export const PLAN_LABEL_STROKE_WIDTH = 3;

export type MeasurePlanLabel = (text: string) => TextMetrics;

/** Keep labels readable at manual zoom levels and let them shrink in distant fits. */
export function planLabelCanvasScale(viewScale: number): number {
  return Math.max(
    1,
    MIN_PLAN_LABEL_SCREEN_SIZE /
      (PLAN_LABEL_FONT_SIZE * Math.max(viewScale, MIN_SCALE)),
  );
}

/** Label positions are centered horizontally on the text's alphabetic baseline. */
export function planLabelRect(
  { position, text }: PlanLabel,
  measure?: MeasurePlanLabel,
  scale = 1,
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
    x: position.x - left * scale,
    y: position.y - above * scale,
    w: (left + right) * scale,
    h: (above + below) * scale,
  };
}
