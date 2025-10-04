import type { Point } from "@app/schema";

export function snapToGrid(p: Point, grid: number): Point {
  return { x: Math.round(p.x / grid) * grid, y: Math.round(p.y / grid) * grid };
}

export function applyInverseViewTransform(
  clientX: number,
  clientY: number,
  svg: SVGSVGElement,
  panX: number,
  panY: number,
  scale: number
): { x: number; y: number } {
  const rect = svg.getBoundingClientRect();
  const x = (clientX - rect.left - panX) / scale;
  const y = (clientY - rect.top - panY) / scale;
  return { x, y };
}
