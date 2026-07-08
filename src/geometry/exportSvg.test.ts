import {
  createInitialPlan,
  type Item,
  type Plan,
  type Wall,
} from "@app/schema";
import { describe, expect, it } from "vitest";
import {
  buildExportSvg,
  EXPORT_BACKGROUND,
  EXPORT_EMPTY_PLACEHOLDER_SIZE,
  EXPORT_MARGIN,
  EXPORT_WALL_COLOR,
} from "./exportSvg";

const wall = (
  ax: number,
  ay: number,
  bx: number,
  by: number,
  thickness = 10,
  id = "w",
): Wall => ({ id, a: { x: ax, y: ay }, b: { x: bx, y: by }, thickness });

const doorItem = (wallId: string, id = "d"): Item => ({
  id,
  type: "door",
  wallAttach: { wallId, offset: 20, length: 20 },
  thickness: 18,
  props: { hingeEdge: "start", swingSide: "outside" },
});

const planOf = (walls: Wall[], items: Item[] = []): Plan => ({
  ...createInitialPlan(),
  walls,
  items,
});

describe("buildExportSvg", () => {
  it("frames an empty plan with a small placeholder, not a crash", () => {
    const { markup, width, height } = buildExportSvg(planOf([]));
    expect(width).toBe(EXPORT_EMPTY_PLACEHOLDER_SIZE + EXPORT_MARGIN * 2);
    expect(height).toBe(EXPORT_EMPTY_PLACEHOLDER_SIZE + EXPORT_MARGIN * 2);
    expect(markup).toContain("<svg");
    expect(markup).toContain(`fill="${EXPORT_BACKGROUND}"`);
  });

  it("sizes the viewBox to the plan's content bounds plus the margin", () => {
    // Wall 0..100 thickness 10 -> content bounds -5..105 x -5..5 (see bounds.test.ts).
    const { width, height, markup } = buildExportSvg(
      planOf([wall(0, 0, 100, 0, 10)]),
    );
    expect(width).toBe(110 + EXPORT_MARGIN * 2);
    expect(height).toBe(10 + EXPORT_MARGIN * 2);
    expect(markup).toContain(
      `viewBox="${-5 - EXPORT_MARGIN} ${-5 - EXPORT_MARGIN} ${width} ${height}"`,
    );
  });

  it("draws one wall polygon per wall, in the fixed export wall color", () => {
    const { markup } = buildExportSvg(
      planOf([wall(0, 0, 100, 0, 10, "a"), wall(0, 0, 0, 100, 10, "b")]),
    );
    const polygonCount = (markup.match(/<polygon/g) ?? []).length;
    expect(polygonCount).toBe(2);
    expect(markup).toContain(`fill="${EXPORT_WALL_COLOR}"`);
  });

  it("skips an item whose wall no longer exists", () => {
    const withOrphan = buildExportSvg(
      planOf([wall(0, 0, 100, 0)], [doorItem("does-not-exist")]),
    );
    const withoutItem = buildExportSvg(planOf([wall(0, 0, 100, 0)]));
    expect(withOrphan.markup).toBe(withoutItem.markup);
  });

  it("draws door items as a rect, swing arc, leaf line, and hinge dot", () => {
    const { markup } = buildExportSvg(
      planOf([wall(0, 0, 100, 0, 10, "a")], [doorItem("a")]),
    );
    expect(markup).toContain("<path");
    expect(markup).toContain("<circle");
  });

  it("excludes grid, selection, and marquee overlays entirely", () => {
    const { markup } = buildExportSvg(planOf([wall(0, 0, 100, 0)]));
    expect(markup).not.toMatch(/data-layer="(grid|selection|marquee)"/);
  });
});
