import { formatSystemArea, formatSystemLength } from "@app/format";
import { isDoor, type Plan } from "@app/schema";
import { getPlanBounds } from "./bounds";
import {
  getDoorArcPath,
  getDoorGeometry,
  getWindowGeometry,
} from "./itemGeometry";
import { computeWallGeometry, polygonToPoints } from "./junction";
import { detectRooms, resolveRoomNames } from "./rooms";
import { getPointOnWall, getWallAngle, getWallLength } from "./wall";

/** Margin (cm) left around the plan's content on every side of the export. */
export const EXPORT_MARGIN = 40;

/** Side length (cm) of the placeholder square used to export an empty plan. */
export const EXPORT_EMPTY_PLACEHOLDER_SIZE = 200;

/** Fixed, theme-independent export colors — chosen for print/share legibility. */
export const EXPORT_BACKGROUND = "#ffffff";
export const EXPORT_WALL_COLOR = "#0f172a";
const LABEL_FONT_SIZE = 12;
const ROOM_LABEL_OFFSET = 8;

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
): ExportSvgResult {
  const bounds = getPlanBounds(plan);
  const half = EXPORT_EMPTY_PLACEHOLDER_SIZE / 2;
  let { minX, minY, maxX, maxY } = bounds ?? {
    minX: -half,
    minY: -half,
    maxX: half,
    maxY: half,
  };
  const rooms = detectRooms(plan.walls);
  const roomNames = resolveRoomNames(rooms, plan.roomNames);
  for (const [room, { name }] of roomNames) {
    // Budget one em per code point to frame long names without depending on
    // installed fonts. The export margin also covers stroke and glyph overhang.
    const halfWidth = (Array.from(name).length * LABEL_FONT_SIZE) / 2;
    const halfHeight = ROOM_LABEL_OFFSET + LABEL_FONT_SIZE;
    const { x, y } = room.labelPoint;
    minX = Math.min(minX, x - halfWidth);
    maxX = Math.max(maxX, x + halfWidth);
    minY = Math.min(minY, y - halfHeight);
    maxY = Math.max(maxY, y + halfHeight);
  }

  const x = minX - margin;
  const y = minY - margin;
  const width = maxX - minX + margin * 2;
  const height = maxY - minY + margin * 2;

  const { walls: wallPolys, junctions } = computeWallGeometry(plan.walls);
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

  const textStyle = `font-family="sans-serif" font-size="${LABEL_FONT_SIZE}" text-anchor="middle" fill="${EXPORT_WALL_COLOR}" stroke="${EXPORT_BACKGROUND}" stroke-width="3" paint-order="stroke"`;
  const dimensions = plan.walls
    .map((wall) => {
      const length = getWallLength(wall);
      const label = formatSystemLength(length, plan.meta.measurementSystem);
      // Keep long imperial labels from spilling past short walls or the frame.
      if (length < label.length * 7) return "";
      const mid = getPointOnWall(wall, length / 2);
      let angle = (getWallAngle(wall) * 180) / Math.PI;
      if (angle > 90 || angle < -90) angle += 180;
      return `<text transform="translate(${mid.x} ${mid.y}) rotate(${angle})" y="${-wall.thickness / 2 - 8}" ${textStyle}>${label}</text>`;
    })
    .join("");
  const roomLabels = rooms
    .map((room) => {
      const { x, y } = room.labelPoint;
      const name = roomNames.get(room)?.name;
      const area = formatSystemArea(room.area, plan.meta.measurementSystem);
      const label = `x="${x}" dominant-baseline="central" ${textStyle}`;
      const nameText = name
        ? `<text ${label} y="${y - ROOM_LABEL_OFFSET}" font-weight="600" xml:space="preserve">${escapeSvgText(name)}</text>`
        : "";
      return `${nameText}<text ${label} y="${name ? y + ROOM_LABEL_OFFSET : y}">${area}</text>`;
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
