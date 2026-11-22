import {
  type MeasurePlanLabel,
  PLAN_LABEL_FONT_FAMILY,
  PLAN_LABEL_FONT_SIZE,
} from "@geometry/planLabels";
import { ROOM_LABEL_FONT_WEIGHT } from "@geometry/roomLabels";

export function createPlanLabelMeasurer(): MeasurePlanLabel | undefined {
  if (typeof CanvasRenderingContext2D === "undefined") return;
  const context = document.createElement("canvas").getContext("2d");
  if (!context) return;
  context.font = `${ROOM_LABEL_FONT_WEIGHT} ${PLAN_LABEL_FONT_SIZE}px ${PLAN_LABEL_FONT_FAMILY}`;
  context.textAlign = "left";
  return (text) => context.measureText(text);
}
