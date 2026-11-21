import { formatSystemArea } from "@app/format";
import { isDoor, type Plan } from "@app/schema";
import { getPlanBounds } from "./bounds";
import {
  getDoorArcPath,
  getDoorGeometry,
  getWindowGeometry,
} from "./itemGeometry";
import { computeWallGeometry, polygonToPoints } from "./junction";
import {
  layoutRoomLabel,
  type MeasureRoomLabel,
  ROOM_LABEL_FONT_SIZE,
} from "./roomLabels";
import { detectRooms, resolveRoomNames } from "./rooms";
import {
  dimensionFootprints,
  WALL_DIMENSION_FONT_SIZE,
  wallDimensions,
} from "./wallDimensions";

/** Margin (cm) left around the plan's content on every side of the export. */
export const EXPORT_MARGIN = 40;

/** Side length (cm) of the placeholder square used to export an empty plan. */
export const EXPORT_EMPTY_PLACEHOLDER_SIZE = 200;

/** Fixed, theme-independent export colors — chosen for print/share legibility. */
export const EXPORT_BACKGROUND = "#ffffff";
export const EXPORT_WALL_COLOR = "#0f172a";
const LABEL_FONT_SIZE = 12;

export interface ExportSvgResult {
  /** Standalone, self-contained SVG markup (no external stylesheet or theme). */
  markup: string;
  /** Export dimensions in cm, i.e. the SVG's viewBox width/height. */
  width: number;
  height: number;
}

function escapeSvgText(text: string): string {
  const invalidXml =
    // biome-ignore lint/suspicious/noControlCharactersInRegex: XML 1.0 cannot represent these characters in text.
    /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uD800-\uDFFF\uFFFE\uFFFF]/gu;
  return text
    .replace(invalidXml, "\uFFFD")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\r", "&#13;");
}

/**
 * Build a standalone SVG of the plan's geometry and labels independent of the
 * live canvas's pan/zoom, grid, and selections. Measurements use the plan's
 * system. The export adds a margin around the content, or around a placeholder
 * square centred on the origin for an empty plan.
 *
 * Colors are fixed (white background, dark walls) rather than theme-aware —
 * export is for sharing/printing, not matching the app's current theme.
 */
export function buildExportSvg(
  plan: Plan,
  margin = EXPORT_MARGIN,
  measure?: MeasureRoomLabel,
): ExportSvgResult {
  const bounds = getPlanBounds(plan);
  const half = EXPORT_EMPTY_PLACEHOLDER_SIZE / 2;
  const { minX, minY, maxX, maxY } = bounds ?? {
    minX: -half,
    minY: -half,
    maxX: half,
    maxY: half,
  };
  const rooms = detectRooms(plan.walls);
  const roomNames = resolveRoomNames(rooms, plan.roomNames);

  const x = minX - margin;
  const y = minY - margin;
  const width = maxX - minX + margin * 2;
  const height = maxY - minY + margin * 2;

  const { walls: wallPolys, junctions } = computeWallGeometry(plan.walls);
  const paintedWalls = [...wallPolys.values(), ...junctions];
  const wallsById = new Map(plan.walls.map((w) => [w.id, w]));

  const wallShapes = plan.walls
    .map((w) => {
      const quad = wallPolys.get(w.id);
      if (!quad) return "";
      return `<polygon points="${polygonToPoints(quad)}" fill="${EXPORT_WALL_COLOR}" />`;
    })
    .join("");

  const junctionShapes = junctions
    .map(
      (poly) =>
        `<polygon points="${polygonToPoints(poly)}" fill="${EXPORT_WALL_COLOR}" />`,
    )
    .join("");

  const itemShapes = plan.items
    .map((item) => {
      const wall = wallsById.get(item.wallAttach.wallId);
      if (!wall) return "";

      if (!isDoor(item)) {
        const { rect, midline } = getWindowGeometry(item, wall);
        return (
          `<g transform="rotate(${rect.angleDeg}, ${rect.cx}, ${rect.cy})">` +
          `<rect x="${rect.x}" y="${rect.y}" width="${rect.width}" height="${rect.height}" fill="${EXPORT_BACKGROUND}" stroke="${EXPORT_WALL_COLOR}" />` +
          `<line x1="${midline.x1}" y1="${midline.y1}" x2="${midline.x2}" y2="${midline.y2}" stroke="${EXPORT_WALL_COLOR}" />` +
          "</g>"
        );
      }

      const geometry = getDoorGeometry(item, wall);
      const { rect, hinge, tipOpen } = geometry;
      return (
        `<rect x="${rect.x}" y="${rect.y}" width="${rect.width}" height="${rect.height}" transform="rotate(${rect.angleDeg}, ${rect.cx}, ${rect.cy})" fill="${EXPORT_BACKGROUND}" stroke="${EXPORT_WALL_COLOR}" />` +
        `<path d="${getDoorArcPath(geometry)}" fill="none" stroke="${EXPORT_WALL_COLOR}" />` +
        `<line x1="${hinge.x}" y1="${hinge.y}" x2="${tipOpen.x}" y2="${tipOpen.y}" stroke="${EXPORT_WALL_COLOR}" />` +
        `<circle cx="${hinge.x}" cy="${hinge.y}" r="3" fill="${EXPORT_WALL_COLOR}" />`
      );
    })
    .join("");

  const textStyle = `font-family="sans-serif" text-anchor="middle" fill="${EXPORT_WALL_COLOR}" stroke="${EXPORT_BACKGROUND}" stroke-width="3" paint-order="stroke"`;
  const dimensionLabels = wallDimensions(
    plan.walls,
    plan.meta.measurementSystem,
  );
  const dimensions = dimensionLabels
    .map(
      ({ midpoint, angle, offset, text }) =>
        `<text transform="translate(${midpoint.x} ${midpoint.y}) rotate(${angle})" y="${-offset}" font-size="${WALL_DIMENSION_FONT_SIZE}" ${textStyle}>${text}</text>`,
    )
    .join("");
  const obstacles = roomNames.size
    ? [...paintedWalls, ...dimensionFootprints(dimensionLabels, 1, measure)]
    : paintedWalls;
  const roomLabels = rooms
    .map((room) => {
      const name = roomNames.get(room)?.name;
      const area = formatSystemArea(room.area, plan.meta.measurementSystem);
      const label = name
        ? layoutRoomLabel(room, name, area, obstacles, 1, measure)
        : undefined;
      const { x, y } = label?.point ?? room.labelPoint;
      if (!name || !label) {
        const areaText = `<text x="${x}" y="${y}" dominant-baseline="central" font-size="${LABEL_FONT_SIZE}" ${textStyle}>${area}</text>`;
        return name
          ? `<g><title>${escapeSvgText(name)}</title>${areaText}</g>`
          : areaText;
      }
      const lines = label.nameLines
        .map(
          (line) =>
            `<text x="0" y="${line.y}" font-weight="600" xml:space="preserve">${escapeSvgText(line.text)}</text>`,
        )
        .join("");
      const title =
        label.shortened || label.nameLines.length > 1
          ? `<title>${escapeSvgText(name)}</title>`
          : "";
      return `<g transform="translate(${x} ${y}) scale(${label.fontScale})" dominant-baseline="central" font-size="${ROOM_LABEL_FONT_SIZE}" ${textStyle}>${title}${lines}<text x="0" y="${label.areaY}">${area}</text></g>`;
    })
    .join("");

  const markup =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="${x} ${y} ${width} ${height}">` +
    `<rect x="${x}" y="${y}" width="${width}" height="${height}" fill="${EXPORT_BACKGROUND}" />` +
    `<g data-layer="walls">${wallShapes}${junctionShapes}</g>` +
    `<g data-layer="items">${itemShapes}</g>` +
    `<g data-layer="dimensions">${dimensions}</g>` +
    `<g data-layer="room-areas">${roomLabels}</g>` +
    "</svg>";

  return { markup, width, height };
}
