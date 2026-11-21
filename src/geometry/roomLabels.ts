import { graphemes } from "@app/roomName";
import { distToSegment } from "./hit";
import type { Room } from "./rooms";

export const ROOM_LABEL_FONT_SIZE = 12;
const LINE_HEIGHT = 16;
const PADDING = 10;
const ELLIPSIS = "…";

export type MeasureRoomLabel = (text: string, weight: 400 | 600) => number;

interface RoomLabel {
  fontScale: number;
  nameLines: { text: string; y: number }[];
  areaY: number;
  shortened: boolean;
}

function graphemeWidth(char: string): number {
  if (/^[\s.,'!:ilI]$/u.test(char)) return ROOM_LABEL_FONT_SIZE * 0.35;
  if (/^[a-z0-9]$/.test(char) && char !== "m" && char !== "w") {
    return ROOM_LABEL_FONT_SIZE * 0.6;
  }
  if (/^[A-Z]$/.test(char) && char !== "M" && char !== "W") {
    return ROOM_LABEL_FONT_SIZE * 0.72;
  }
  return ROOM_LABEL_FONT_SIZE;
}

// Deterministic fallback for pure exports and environments without canvas.
function estimateWidth(text: string): number {
  let width = 0;
  for (const grapheme of graphemes(text)) width += graphemeWidth(grapheme);
  return width;
}

function fitPrefix(
  text: string,
  maxWidth: number,
  measure: (text: string) => number,
  suffix = "",
): string {
  const ends = [0];
  let end = 0;
  for (const grapheme of graphemes(text)) {
    end += grapheme.length;
    ends.push(end);
  }
  let low = 0;
  let high = ends.length - 1;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (measure(text.slice(0, ends[mid]) + suffix) <= maxWidth) low = mid;
    else high = mid - 1;
  }
  return text.slice(0, ends[low]);
}

function fitLine(
  text: string,
  maxWidth: number,
  measure: (text: string) => number,
): string {
  return measure(text) <= maxWidth
    ? text
    : fitPrefix(text, maxWidth, measure, ELLIPSIS) + ELLIPSIS;
}

/** Width of the largest rectangle centered on the label and staying in the face. */
function roomWidthAcrossBand(room: Room, halfHeight: number): number {
  const { x, y } = room.labelPoint;
  let halfWidth = Number.POSITIVE_INFINITY;
  for (let i = 1; i < room.polygon.length; i++) {
    const a = room.polygon[i - 1];
    const b = room.polygon[i];
    const low = Math.max(y - halfHeight, Math.min(a.y, b.y));
    const high = Math.min(y + halfHeight, Math.max(a.y, b.y));
    if (low > high) continue;
    const xAt = (atY: number) =>
      a.x + ((atY - a.y) * (b.x - a.x)) / (b.y - a.y);
    const edge = a.y === b.y ? [a.x, b.x] : [xAt(low), xAt(high)];
    const distance = Math.max(Math.min(...edge) - x, x - Math.max(...edge), 0);
    halfWidth = Math.min(halfWidth, distance);
  }
  return halfWidth * 2;
}

function labelHalfHeight(rows: number): number {
  return ((rows - 1) * LINE_HEIGHT) / 2 + ROOM_LABEL_FONT_SIZE / 2 + PADDING;
}

/** Fit the name and area using the renderer's text measurements. */
export function layoutRoomLabel(
  room: Room,
  name: string,
  area: string,
  viewScale = 1,
  measure: MeasureRoomLabel = estimateWidth,
): RoomLabel {
  const measureName = (text: string) => measure(text, 600);
  let fontScale = 1;
  const widthFor = (rows: number) =>
    (roomWidthAcrossBand(
      room,
      (labelHalfHeight(rows) * fontScale) / viewScale,
    ) *
      viewScale) /
      fontScale -
    PADDING * 2;
  const minWidth = Math.max(measure(area, 400), measureName(ELLIPSIS));
  if (widthFor(2) < minWidth) {
    // A box this small needs reduced type even for one name line and the full
    // area. Fit both inside the circle that reaches the nearest boundary.
    let clearance = Number.POSITIVE_INFINITY;
    for (let i = 1; i < room.polygon.length; i++) {
      clearance = Math.min(
        clearance,
        distToSegment(room.labelPoint, room.polygon[i - 1], room.polygon[i]),
      );
    }
    fontScale = Math.min(
      1,
      (clearance * viewScale) /
        Math.hypot(minWidth / 2 + PADDING, labelHalfHeight(2)),
    );
  }

  const single = fitLine(name, widthFor(2), measureName);
  let names = [single];
  let shortened = single !== name;
  if (shortened) {
    const wrappedWidth = widthFor(3);
    if (wrappedWidth >= minWidth) {
      const prefix = fitPrefix(name, wrappedWidth, measureName);
      const wordBreak = prefix.search(/\s+\S*$/u);
      const first =
        wordBreak > 0 &&
        /\S/u.test(prefix.slice(0, wordBreak)) &&
        !/^\s/u.test(name.slice(prefix.length))
          ? prefix.slice(0, wordBreak)
          : prefix;
      const remaining = name.slice(first.length).trimStart();
      const second = fitLine(remaining, wrappedWidth, measureName);
      names = [first, second];
      shortened = second !== remaining;
    }
  }

  const areaY = (names.length * LINE_HEIGHT) / 2;
  return {
    fontScale,
    nameLines: names.map((text, index) => ({
      text,
      y: index * LINE_HEIGHT - areaY,
    })),
    areaY,
    shortened,
  };
}
