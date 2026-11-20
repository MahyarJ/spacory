import { distToSegment } from "./hit";
import type { Room } from "./rooms";

export const ROOM_LABEL_FONT_SIZE = 12;
const LINE_HEIGHT = 16;
const PADDING = 10;
const ELLIPSIS = "…";
const segmenter =
  typeof Intl.Segmenter === "function"
    ? new Intl.Segmenter(undefined, { granularity: "grapheme" })
    : null;

interface TextLine {
  text: string;
  width: number;
}

interface RoomLabel {
  fontScale: number;
  nameLines: (TextLine & { y: number })[];
  area: { width: number; y: number };
  shortened: boolean;
}

function graphemeWidth(char: string): number {
  // Approximate proportional advances. Both SVG renderers enforce the planned
  // width so font fallback cannot spread a row into the neighboring face.
  if (/^[\s.,'!:ilI]$/u.test(char)) return ROOM_LABEL_FONT_SIZE * 0.35;
  if (/^[a-z0-9]$/.test(char) && char !== "m" && char !== "w") {
    return ROOM_LABEL_FONT_SIZE * 0.6;
  }
  if (/^[A-Z]$/.test(char) && char !== "M" && char !== "W") {
    return ROOM_LABEL_FONT_SIZE * 0.72;
  }
  return ROOM_LABEL_FONT_SIZE;
}

function fitPrefix(text: string, maxWidth: number) {
  let end = 0;
  let width = 0;
  let wordBreak: { end: number; width: number } | undefined;
  // The string iterator still keeps surrogate pairs together on older browsers.
  for (const part of segmenter?.segment(text) ?? text) {
    const segment = typeof part === "string" ? part : part.segment;
    if (end > 0 && /^\s$/u.test(segment)) wordBreak = { end, width };
    const next = width + graphemeWidth(segment);
    if (next > maxWidth) break;
    end += segment.length;
    width = next;
  }
  return { end, width, wordBreak };
}

function fitLine(text: string, maxWidth: number): TextLine {
  const full = fitPrefix(text, maxWidth);
  if (full.end === text.length) return { text, width: full.width };
  const markWidth = graphemeWidth(ELLIPSIS);
  const prefix = fitPrefix(text, maxWidth - markWidth);
  return {
    text: text.slice(0, prefix.end) + ELLIPSIS,
    width: prefix.width + markWidth,
  };
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

/** Fit a room's name and area at the same size in the editor and image exports. */
export function layoutRoomLabel(
  room: Room,
  name: string,
  area: string,
  viewScale = 1,
): RoomLabel {
  const areaWidth = fitPrefix(area, Number.POSITIVE_INFINITY).width;
  let fontScale = 1;
  const widthFor = (rows: number) =>
    (roomWidthAcrossBand(
      room,
      (labelHalfHeight(rows) * fontScale) / viewScale,
    ) *
      viewScale) /
      fontScale -
    PADDING * 2;
  const minWidth = Math.max(areaWidth, graphemeWidth(ELLIPSIS));
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

  const single = fitLine(name, widthFor(2));
  let names = [single];
  let shortened = single.text !== name;
  if (shortened) {
    const wrappedWidth = widthFor(3);
    if (wrappedWidth >= minWidth) {
      const first = fitPrefix(name, wrappedWidth);
      const split = first.wordBreak ?? first;
      const remaining = name.slice(split.end).trimStart();
      const second = fitLine(remaining, wrappedWidth);
      names = [{ text: name.slice(0, split.end), width: split.width }, second];
      shortened = second.text !== remaining;
    }
  }

  const areaY = (names.length * LINE_HEIGHT) / 2;
  return {
    fontScale,
    nameLines: names.map((line, index) => ({
      ...line,
      y: index * LINE_HEIGHT - areaY,
    })),
    area: { width: areaWidth, y: areaY },
    shortened,
  };
}
