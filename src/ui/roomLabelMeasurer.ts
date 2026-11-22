import {
  type MeasureRoomLabel,
  ROOM_LABEL_FONT_FAMILY,
} from "@geometry/roomLabels";

export function createRoomLabelMeasurer(): MeasureRoomLabel | undefined {
  if (typeof CanvasRenderingContext2D === "undefined") return;
  const context = document.createElement("canvas").getContext("2d");
  if (!context) return;
  context.textAlign = "center";

  let lastFont: string | undefined;
  return (text, weight, fontSize) => {
    const font = `${weight} ${fontSize}px ${ROOM_LABEL_FONT_FAMILY}`;
    if (font !== lastFont) {
      context.font = font;
      lastFont = font;
    }
    return context.measureText(text);
  };
}
