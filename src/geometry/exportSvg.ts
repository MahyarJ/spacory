import { isDoor, type Plan } from "@app/schema";
import { getPlanBounds } from "./bounds";
import {
  getDoorArcPath,
  getDoorGeometry,
  getWindowGeometry,
} from "./itemGeometry";
import { computeWallGeometry, polygonToPoints } from "./junction";

/** Margin (cm) left around the plan's content on every side of the export. */
export const EXPORT_MARGIN = 40;

/** Side length (cm) of the placeholder square used to export an empty plan. */
export const EXPORT_EMPTY_PLACEHOLDER_SIZE = 200;

/** Fixed, theme-independent export colors — chosen for print/share legibility. */
export const EXPORT_BACKGROUND = "#ffffff";
export const EXPORT_WALL_COLOR = "#0f172a";

export interface ExportSvgResult {
  /** Standalone, self-contained SVG markup (no external stylesheet or theme). */
  markup: string;
  /** Export dimensions in cm, i.e. the SVG's viewBox width/height. */
  width: number;
  height: number;
}

/**
 * Build a standalone SVG document of a plan's content — walls (mitered, with
 * junction fills) and items — independent of the live canvas's pan/zoom, grid,
 * and selection overlays. Framed to the plan's content bounding box
 * (`getPlanBounds`) plus `EXPORT_MARGIN`; an empty plan falls back to a small
 * placeholder square centered on the origin so the result is always a valid,
 * non-crashing image.
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
  const { minX, minY, maxX, maxY } = bounds ?? {
    minX: -half,
    minY: -half,
    maxX: half,
    maxY: half,
  };

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

  const markup =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="${x} ${y} ${width} ${height}">` +
    `<rect x="${x}" y="${y}" width="${width}" height="${height}" fill="${EXPORT_BACKGROUND}" />` +
    `<g data-layer="walls">${wallShapes}${junctionShapes}</g>` +
    `<g data-layer="items">${itemShapes}</g>` +
    "</svg>";

  return { markup, width, height };
}
