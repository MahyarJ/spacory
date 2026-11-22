import { formatSystemLength } from "@app/format";
import type { MeasurementSystem, Point, Wall } from "@app/schema";
import type { MeasureRoomLabel } from "./roomLabels";
import { getPointOnWall, getWallAngle, getWallLength } from "./wall";

export const WALL_DIMENSION_FONT_SIZE = 12;
const GAP = 8;
const MIN_CANVAS_LENGTH = 24;
const HALO = 2;

export interface WallDimension {
  id: string;
  text: string;
  midpoint: Point;
  angle: number;
  offset: number;
}

/** Editor labels counter-scale. Passing no scale uses the export visibility rule. */
export function wallDimensions(
  walls: Wall[],
  system: MeasurementSystem,
  viewScale?: number,
): WallDimension[] {
  const scale = viewScale ?? 1;
  return walls.flatMap((wall) => {
    const length = getWallLength(wall);
    const text = formatSystemLength(length, system);
    if (
      viewScale === undefined
        ? length < text.length * 7
        : length * scale < MIN_CANVAS_LENGTH
    )
      return [];
    const midpoint = getPointOnWall(wall, length / 2);
    let angle = (getWallAngle(wall) * 180) / Math.PI;
    if (angle > 90 || angle < -90) angle += 180;
    return [
      {
        id: wall.id,
        text,
        midpoint,
        angle,
        offset: (wall.thickness / 2) * scale + GAP,
      },
    ];
  });
}

/** Painted text bounds including the halo, rotated back into world coordinates. */
export function dimensionFootprints(
  dimensions: WallDimension[],
  measure?: MeasureRoomLabel,
  scale = 1,
): Point[][] {
  return dimensions.map(({ text, midpoint, angle, offset }) => {
    const metrics = measure?.(text, 400, WALL_DIMENSION_FONT_SIZE);
    const width =
      (typeof metrics === "number" ? metrics : metrics?.width) ??
      text.length * 7;
    const measured = typeof metrics === "object" ? metrics : undefined;
    const left = -(measured?.actualBoundingBoxLeft ?? width / 2) - HALO;
    const right = (measured?.actualBoundingBoxRight ?? width / 2) + HALO;
    const top =
      -offset -
      (measured?.actualBoundingBoxAscent ?? WALL_DIMENSION_FONT_SIZE * 0.8) -
      HALO;
    const bottom =
      -offset +
      (measured?.actualBoundingBoxDescent ?? WALL_DIMENSION_FONT_SIZE * 0.2) +
      HALO;
    const radians = (angle * Math.PI) / 180;
    const cos = Math.cos(radians);
    const sin = Math.sin(radians);
    return [
      [left, top],
      [right, top],
      [right, bottom],
      [left, bottom],
    ].map(([x, y]) => ({
      x: midpoint.x + (x * cos - y * sin) / scale,
      y: midpoint.y + (x * sin + y * cos) / scale,
    }));
  });
}
