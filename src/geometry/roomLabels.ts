import { formatSystemArea } from "@app/format";
import { graphemes } from "@app/roomName";
import type {
  Item,
  MeasurementSystem,
  Point,
  RoomName,
  Wall,
} from "@app/schema";
import { doorSwingFootprints } from "./itemGeometry";
import { findRoomAt, type Room } from "./rooms";
import { dimensionFootprints, wallDimensions } from "./wallDimensions";

export const ROOM_LABEL_FONT_SIZE = 28;
export const ROOM_AREA_FONT_SIZE = 24;
export const ROOM_LABEL_FONT_WEIGHT = 600;
export const ROOM_LABEL_FONT_FAMILY = "system-ui, sans-serif";
const NAME_LINE_HEIGHT = ROOM_LABEL_FONT_SIZE + 4;
const PADDING = 4;
const ELLIPSIS = "…";
const BAND_GAP = 1e-5;

export type MeasureRoomLabel = (
  text: string,
  weight: 400 | 600,
  fontSize: number,
) => number | TextMetrics;

interface RoomLabel {
  point: Point;
  nameLines: { text: string; y: number }[];
  areaY: number;
  shortened: boolean;
}

export interface RoomAnnotation {
  room: Room;
  name: string | undefined;
  area: string;
  label: RoomLabel | undefined;
}

function graphemeWidth(char: string, fontSize: number): number {
  if (/^[\s.,'!:ilI]$/u.test(char)) return fontSize * 0.35;
  if (/^[a-z0-9]$/.test(char) && char !== "m" && char !== "w") {
    return fontSize * 0.6;
  }
  if (/^[A-Z]$/.test(char) && char !== "M" && char !== "W") {
    return fontSize * 0.72;
  }
  return fontSize;
}

// Deterministic fallback for pure exports and environments without canvas.
const estimateWidth: MeasureRoomLabel = (text, _weight, fontSize) => {
  let width = 0;
  for (const grapheme of graphemes(text))
    width += graphemeWidth(grapheme, fontSize);
  return width;
};

function textWidth(
  text: string,
  weight: 400 | 600,
  fontSize: number,
  measure: MeasureRoomLabel,
) {
  const result = measure(text, weight, fontSize);
  return typeof result === "number" ? result : result.width;
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

function labelHalfHeight(nameRows: number): number {
  return (nameRows * NAME_LINE_HEIGHT + ROOM_AREA_FONT_SIZE) / 2 + PADDING;
}

function wrappedName(
  name: string,
  width: number,
  measure: (text: string) => number,
): string[] | undefined {
  const prefix = fitPrefix(name, width, measure).trimEnd();
  const split = /^\s/u.test(name.slice(prefix.length))
    ? prefix.length
    : prefix.search(/\s+\S*$/u);
  if (split <= 0) return;
  const first = name.slice(0, split);
  const remaining = name.slice(split).trimStart();
  return [first, fitLine(remaining, width, measure)];
}

/** Fit the name and area in world coordinates. */
function layoutRoomLabel(
  room: Room,
  name: string,
  area: string,
  painted: readonly Polygon[],
  measure: MeasureRoomLabel = estimateWidth,
): RoomLabel | undefined {
  const measuredWidths = new Map<string, number>();
  const measureName = (text: string) => {
    const cached = measuredWidths.get(text);
    if (cached !== undefined) return cached;
    const width = textWidth(
      text,
      ROOM_LABEL_FONT_WEIGHT,
      ROOM_LABEL_FONT_SIZE,
      measure,
    );
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
  const minWidth = Math.max(
    textWidth(area, 400, ROOM_AREA_FONT_SIZE, measure),
    measureName(ELLIPSIS),
  );
  const makeLabel = (point: Point, names: string[]): RoomLabel => {
    const top = PADDING - labelHalfHeight(names.length);
    return {
      point,
      nameLines: names.map((text, index) => ({
        text,
        y: top + index * NAME_LINE_HEIGHT + ROOM_LABEL_FONT_SIZE / 2,
      })),
      areaY: top + names.length * NAME_LINE_HEIGHT + ROOM_AREA_FONT_SIZE / 2,
      shortened: names.join("").replace(/\s/g, "") !== name.replace(/\s/g, ""),
    };
  };

  let abbreviated: RoomLabel | undefined;
  let bestLength = 0;
  for (const rows of [1, 2]) {
    const halfHeight = labelHalfHeight(rows);
    // Consider the preferred point and the bands on either side of painted edges.
    const offset = halfHeight + BAND_GAP;
    const candidates = [
      preferredY,
      ...levels.flatMap((y) => [y - offset, y + offset]),
    ]
      .filter((y) => y - halfHeight > top && y + halfHeight < bottom)
      .sort((a, b) => Math.abs(a - preferredY) - Math.abs(b - preferredY));
    for (const y of candidates) {
      const space = visibleBand(room, obstacles, y, halfHeight);
      if (!space) continue;
      const width = space.width - PADDING * 2;
      if (width < minWidth) continue;
      if (measureName(name) <= width) return makeLabel(space.point, [name]);

      const names =
        rows === 1
          ? [fitLine(name, width, measureName)]
          : wrappedName(name, width, measureName);
      if (!names) continue;
      const label = makeLabel(space.point, names);
      if (!label.shortened) return label;
      const length = names.join("").length;
      if (length > bestLength) {
        abbreviated = label;
        bestLength = length;
      }
    }
  }
  return abbreviated;
}

export function layoutRoomLabels({
  rooms,
  names,
  walls,
  items,
  system,
  paintedWalls,
  measure,
}: {
  rooms: readonly Room[];
  names: ReadonlyMap<Room, RoomName>;
  walls: Wall[];
  items: Item[];
  system: MeasurementSystem;
  paintedWalls: readonly Polygon[];
  measure?: MeasureRoomLabel;
}): RoomAnnotation[] {
  const obstacles = names.size
    ? [
        ...paintedWalls,
        ...dimensionFootprints(wallDimensions(walls, system), measure),
        ...doorSwingFootprints(
          items,
          new Map(walls.map((wall) => [wall.id, wall])),
        ),
      ]
    : paintedWalls;
  return rooms.map((room) => {
    const name = names.get(room)?.name;
    const area = formatSystemArea(room.area, system);
    const label = name
      ? layoutRoomLabel(room, name, area, obstacles, measure)
      : undefined;
    return { room, name, area, label };
  });
}
