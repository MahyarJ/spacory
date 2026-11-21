import { graphemes } from "@app/roomName";
import type { Point } from "@app/schema";
import { distToSegment } from "./hit";
import { findRoomAt, type Room } from "./rooms";

export const ROOM_LABEL_FONT_SIZE = 12;
const LINE_HEIGHT = 16;
const PADDING = 4;
const ELLIPSIS = "…";
const BAND_GAP = 1e-5;

export type MeasureRoomLabel = (
  text: string,
  weight: 400 | 600,
) => number | TextMetrics;

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
    if (width > (best?.width ?? BAND_GAP)) {
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

function wrappedName(
  name: string,
  width: number,
  measure: (text: string) => number,
): string[] {
  const prefix = fitPrefix(name, width, measure);
  const wordBreak = prefix.search(/\s+\S*$/u);
  const first =
    wordBreak > 0 &&
    /\S/u.test(prefix.slice(0, wordBreak)) &&
    !/^\s/u.test(name.slice(prefix.length))
      ? prefix.slice(0, wordBreak)
      : prefix;
  const remaining = name.slice(first.length).trimStart();
  return [first, fitLine(remaining, width, measure)];
}

/** Fit the name and area using the renderer's text measurements. */
export function layoutRoomLabel(
  room: Room,
  name: string,
  area: string,
  painted: readonly Polygon[],
  viewScale = 1,
  measure: MeasureRoomLabel = estimateWidth,
): RoomLabel | undefined {
  const measuredWidths = new Map<string, number>();
  const widthOf = (text: string, weight: 400 | 600) => {
    const result = measure(text, weight);
    return typeof result === "number" ? result : result.width;
  };
  const measureName = (text: string) => {
    const cached = measuredWidths.get(text);
    if (cached !== undefined) return cached;
    const width = widthOf(text, 600);
    measuredWidths.set(text, width);
    return width;
  };
  const xs = room.polygon.map((p) => p.x);
  const ys = room.polygon.map((p) => p.y);
  const left = Math.min(...xs);
  const right = Math.max(...xs);
  const top = Math.min(...ys);
  const bottom = Math.max(...ys);
  const obstacles = [
    ...room.nested,
    ...painted.filter(
      (polygon) =>
        !polygon.every((p) => p.x < left) &&
        !polygon.every((p) => p.x > right) &&
        !polygon.every((p) => p.y < top) &&
        !polygon.every((p) => p.y > bottom),
    ),
  ];
  const preferredY = room.labelPoint.y;
  const levels = [
    ...new Set([
      ...ys,
      ...obstacles.flatMap((polygon) => polygon.map((p) => p.y)),
    ]),
  ].sort((a, b) => a - b);
  const minWidth = Math.max(widthOf(area, 400), measureName(ELLIPSIS));
  const makeLabel = (
    point: Point,
    names: string[],
    fontScale: number,
  ): RoomLabel => {
    const areaY = (names.length * LINE_HEIGHT) / 2;
    return {
      point,
      fontScale,
      nameLines: names.map((text, index) => ({
        text,
        y: index * LINE_HEIGHT - areaY,
      })),
      areaY,
      shortened: names.join("").replace(/\s/g, "") !== name.replace(/\s/g, ""),
    };
  };

  let abbreviated: RoomLabel | undefined;
  let bestLength = 0;
  for (const fontScale of [1, 0.85, 0.72, 0.64, 0.56]) {
    // Skip looking for full text at smaller sizes if even the face's full
    // width would be insufficient. Imported names may be very long.
    if (
      abbreviated &&
      measureName(name) * fontScale > 2 * (right - left) * viewScale
    )
      break;
    const widths = new Map<string, string[]>();
    let full: RoomLabel | undefined;
    for (const rows of [1, 2]) {
      const halfHeight = (labelHalfHeight(rows + 1) * fontScale) / viewScale;
      // Consider each side of the painted edges. The small nudge keeps the
      // band beyond the edge even with floating-point roundoff.
      const offset = halfHeight + BAND_GAP;
      const candidates = [
        preferredY,
        ...levels.flatMap((y) => [y - offset, y + offset]),
      ]
        .filter((y) => y - halfHeight > top && y + halfHeight < bottom)
        .sort((a, b) => Math.abs(a - preferredY) - Math.abs(b - preferredY));
      for (const y of candidates) {
        const distance = Math.abs(y - preferredY);
        if (full && distance >= Math.abs(full.point.y - preferredY)) break;
        const space = visibleBand(room, obstacles, y, halfHeight);
        if (!space) continue;
        const width = (space.width * viewScale) / fontScale - PADDING * 2;
        if (width < minWidth) continue;
        const key = `${rows}:${width}`;
        let names = widths.get(key);
        if (!names) {
          names =
            rows === 1 || measureName(name) <= width
              ? [fitLine(name, width, measureName)]
              : wrappedName(name, width, measureName);
          widths.set(key, names);
        }
        const label = makeLabel(space.point, names, fontScale);
        if (!label.shortened) {
          full = label;
          break;
        }
        const length = names.join("").length;
        if (
          !abbreviated ||
          (fontScale === abbreviated.fontScale && length > bestLength)
        ) {
          abbreviated = label;
          bestLength = length;
        }
      }
    }
    if (full) return full;
  }
  if (abbreviated) return abbreviated;

  // For a tiny room, preserve at least an abbreviated name and the full area.
  // Fit both inside the circle that reaches the nearest painted boundary.
  let visible: ReturnType<typeof visibleBand>;
  let clearance = BAND_GAP;
  for (let i = 1; i < levels.length; i++) {
    const y = levels[i - 1] + (levels[i] - levels[i - 1]) / 2;
    if (y <= top || y >= bottom) continue;
    const candidate = visibleBand(room, obstacles, y, 0);
    if (!candidate) continue;
    const distance = labelClearance(candidate.point, [
      room.polygon,
      ...obstacles,
    ]);
    if (distance > clearance) {
      clearance = distance;
      visible = candidate;
    }
  }
  if (!visible) return;
  const fontScale = Math.min(
    1,
    (clearance * viewScale) /
      Math.hypot(minWidth / 2 + PADDING, labelHalfHeight(2)),
  );
  return makeLabel(
    visible.point,
    [fitLine(name, minWidth, measureName)],
    fontScale,
  );
}
