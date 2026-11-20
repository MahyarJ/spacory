import {
  type MeasureRoomLabel,
  ROOM_LABEL_FONT_SIZE,
} from "@geometry/roomLabels";

export function createRoomLabelMeasurer(
  fontFamily = "sans-serif",
): MeasureRoomLabel | undefined {
  if (typeof CanvasRenderingContext2D === "undefined") return;
  const context = document.createElement("canvas").getContext("2d");
  if (!context) return;

  let measuredWeight: 400 | 600 | undefined;
  return (text, weight) => {
    if (weight !== measuredWeight) {
      context.font = `${weight} ${ROOM_LABEL_FONT_SIZE}px ${fontFamily}`;
      measuredWeight = weight;
    }
    return context.measureText(text).width;
  };
}
