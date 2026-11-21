import { graphemes } from "@app/roomName";
import type { Point } from "@app/schema";
import { distToSegment } from "./hit";
import { findRoomAt, type Room } from "./rooms";

export const ROOM_LABEL_FONT_SIZE = 12;
const LINE_HEIGHT = 16;
const PADDING = 4;
const ELLIPSIS = "…";

export type MeasureRoomLabel = (text: string, weight: 400 | 600) => number;

interface RoomLabel {
  point: Point;
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

type Span = [left: number, right: number];
type Polygon = readonly Point[];

function edgeInBand(
  a: Point,
  b: Point,
  top: number,
  bottom: number,
): Span | undefined {
  const low = Math.max(top, Math.min(a.y, b.y));
  const high = Math.min(bottom, Math.max(a.y, b.y));
  if (low > high) return;
  if (a.y === b.y) return [Math.min(a.x, b.x), Math.max(a.x, b.x)];
  const dxdy = (b.x - a.x) / (b.y - a.y);
  const x1 = a.x + (low - a.y) * dxdy;
  const x2 = a.x + (high - a.y) * dxdy;
  return [Math.min(x1, x2), Math.max(x1, x2)];
}

/** Project face edges and solid wall fills across the full height of a label. */
function visibleBand(
  room: Room,
  walls: readonly Polygon[],
  y: number,
  halfHeight: number,
) {
  const top = y - halfHeight;
  const bottom = y + halfHeight;
  const blocked: Span[] = [];
  for (let i = 1; i < room.polygon.length; i++) {
    const span = edgeInBand(room.polygon[i - 1], room.polygon[i], top, bottom);
    if (span) blocked.push(span);
  }
  for (const wall of walls) {
    let left = Number.POSITIVE_INFINITY;
    let right = Number.NEGATIVE_INFINITY;
    for (let i = 0; i < wall.length; i++) {
      const span = edgeInBand(
        wall[i],
        wall[(i + 1) % wall.length],
        top,
        bottom,
      );
      if (span) {
        left = Math.min(left, span[0]);
        right = Math.max(right, span[1]);
      }
    }
    if (left <= right) blocked.push([left, right]);
  }
  blocked.sort((a, b) => a[0] - b[0]);
  let farthest = blocked[0]?.[1] ?? 0;
  let best: { point: Point; width: number } | undefined;
  for (const [left, right] of blocked) {
    const width = left - farthest;
    if (width > (best?.width ?? 0)) {
      const point = { x: farthest + width / 2, y };
      if (findRoomAt([room], point)) best = { point, width };
    }
    farthest = Math.max(farthest, right);
  }
  return best;
}

function labelClearance(point: Point, polygons: readonly Polygon[]): number {
  let clearance = Number.POSITIVE_INFINITY;
  for (const polygon of polygons) {
    for (let i = 0; i < polygon.length; i++) {
      clearance = Math.min(
        clearance,
        distToSegment(point, polygon[i], polygon[(i + 1) % polygon.length]),
      );
    }
  }
  return clearance;
}

function labelHalfHeight(rows: number): number {
  return ((rows - 1) * LINE_HEIGHT) / 2 + ROOM_LABEL_FONT_SIZE / 2 + PADDING;
}

/** Fit the name and area using the renderer's text measurements. */
export function layoutRoomLabel(
  room: Room,
  name: string,
  area: string,
  walls: readonly Polygon[],
  viewScale = 1,
  measure: MeasureRoomLabel = estimateWidth,
): RoomLabel | undefined {
  const measureName = (text: string) => measure(text, 600);
  let y = room.labelPoint.y;
  let fontScale = 1;
  const band = (rows: number) =>
    visibleBand(
      room,
      walls,
      y,
      (labelHalfHeight(rows) * fontScale) / viewScale,
    );
  const widthFor = (width: number) =>
    (width * viewScale) / fontScale - PADDING * 2;
  const minWidth = Math.max(measure(area, 400), measureName(ELLIPSIS));
  let space = band(2);
  if (!space || widthFor(space.width) < minWidth) {
    // Try the center in a shallower band. If a wall covers the whole row, try
    // the gaps between painted vertices elsewhere in the face.
    let visible = visibleBand(room, walls, y, 0);
    if (!visible) {
      const ys = room.polygon.map((point) => point.y);
      const xs = room.polygon.map((point) => point.x);
      const top = Math.min(...ys);
      const bottom = Math.max(...ys);
      const left = Math.min(...xs);
      const right = Math.max(...xs);
      for (const wall of walls) {
        if (
          wall.every((point) => point.x < left) ||
          wall.every((point) => point.x > right)
        )
          continue;
        for (const point of wall) {
          if (point.y > top && point.y < bottom) ys.push(point.y);
        }
      }
      ys.sort((a, b) => a - b);
      for (let i = 1; i < ys.length; i++) {
        if (ys[i] === ys[i - 1]) continue;
        const candidate = visibleBand(room, walls, (ys[i - 1] + ys[i]) / 2, 0);
        if (candidate && (!visible || candidate.width > visible.width))
          visible = candidate;
      }
    }
    if (!visible) return;
    y = visible.point.y;
    const clearance = labelClearance(visible.point, [room.polygon, ...walls]);
    fontScale = Math.min(
      1,
      (clearance * viewScale) /
        Math.hypot(minWidth / 2 + PADDING, labelHalfHeight(2)),
    );
    if (fontScale <= 0) return;
    space = band(2);
    if (!space) return;
  }

  const single = fitLine(name, widthFor(space.width), measureName);
  let names = [single];
  let shortened = single !== name;
  if (shortened) {
    const wrappedSpace = band(3);
    const wrappedWidth = widthFor(wrappedSpace?.width ?? 0);
    if (wrappedSpace && wrappedWidth >= minWidth) {
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
      space = wrappedSpace;
    }
  }

  const areaY = (names.length * LINE_HEIGHT) / 2;
  return {
    point: space.point,
    fontScale,
    nameLines: names.map((text, index) => ({
      text,
      y: index * LINE_HEIGHT - areaY,
    })),
    areaY,
    shortened,
  };
}
