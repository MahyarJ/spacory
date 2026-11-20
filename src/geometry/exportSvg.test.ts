import {
  createInitialPlan,
  type DoorItem,
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
import { getDoorGeometry, getDoorSweepPoints } from "./itemGeometry";

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

  it("frames a perimeter door's whole swing arc plus the margin", () => {
    // Door on the outermost wall swinging outward: the arc's radius equals the
    // opening's 80cm length, so it reaches y = -80 — 75cm past the wall's own
    // -5 edge, which the fixed 40cm margin alone could never cover.
    const outerWall = wall(0, 0, 400, 0, 10, "a");
    const outwardDoor: DoorItem = {
      id: "d",
      type: "door",
      wallAttach: { wallId: "a", offset: 100, length: 80 },
      thickness: 10,
      props: { hingeEdge: "end", swingSide: "outside" },
    };
    const { markup, width, height } = buildExportSvg(
      planOf([outerWall], [outwardDoor]),
    );

    // Content bounds -5..405 x -80..5 (see bounds.test.ts), inflated by margin.
    expect(width).toBe(410 + EXPORT_MARGIN * 2);
    expect(height).toBe(85 + EXPORT_MARGIN * 2);
    expect(markup).toContain(
      `viewBox="${-5 - EXPORT_MARGIN} ${-80 - EXPORT_MARGIN} ${width} ${height}"`,
    );

    // Every point of the drawn sweep clears all four edges by the full margin.
    const [vx, vy, vw, vh] = (/viewBox="([^"]+)"/.exec(markup)?.[1] ?? "")
      .split(" ")
      .map(Number);
    for (const p of getDoorSweepPoints(
      getDoorGeometry(outwardDoor, outerWall),
    )) {
      expect(p.x).toBeGreaterThanOrEqual(vx + EXPORT_MARGIN);
      expect(p.x).toBeLessThanOrEqual(vx + vw - EXPORT_MARGIN);
      expect(p.y).toBeGreaterThanOrEqual(vy + EXPORT_MARGIN);
      expect(p.y).toBeLessThanOrEqual(vy + vh - EXPORT_MARGIN);
    }
  });

  it("keeps EXPORT_MARGIN fixed — the arc is covered by the bounds, not padding", () => {
    expect(EXPORT_MARGIN).toBe(40);
  });

  it("excludes grid, selection, and marquee overlays entirely", () => {
    const { markup } = buildExportSvg(planOf([wall(0, 0, 100, 0)]));
    expect(markup).not.toMatch(/data-layer="(grid|selection|marquee)"/);
  });
});

it("uses the plan's system for measurements in shared SVG/PNG markup", () => {
  const plan = planOf([
    wall(0, 0, 400, 0, 10, "a"),
    wall(400, 0, 400, 300, 10, "b"),
    wall(400, 300, 0, 300, 10, "c"),
    wall(0, 300, 0, 0, 10, "d"),
  ]);
  const metric = buildExportSvg(plan);
  const imperial = buildExportSvg({
    ...plan,
    meta: { ...plan.meta, measurementSystem: "imperial" },
  });
  expect(metric.markup).toContain(">400 cm</text>");
  expect(metric.markup).toContain(">12 m²</text>");
  expect(imperial.markup).toContain(">13′ 1.5″</text>");
  expect(imperial.markup).toContain(">129.17 ft²</text>");
  expect(imperial.width).toBe(metric.width);
  expect(imperial.height).toBe(metric.height);
});

it("exports visible names as escaped Unicode text next to the area", () => {
  const plan = planOf([
    wall(0, 0, 400, 0, 10, "a"),
    wall(400, 0, 400, 300, 10, "b"),
    wall(400, 300, 0, 300, 10, "c"),
    wall(0, 300, 0, 0, 10, "d"),
  ]);
  plan.roomNames = [
    { anchor: { x: 100, y: 150 }, name: 'Cuisine & 茶室 <🏠> "special"' },
    { anchor: { x: 300, y: 150 }, name: "Hidden while merged" },
    { anchor: { x: 500, y: 150 }, name: "Unenclosed" },
  ];
  const { markup } = buildExportSvg(plan);
  expect(markup).toContain('Cuisine &amp; 茶室 &lt;🏠&gt; "special"</text>');
  expect(markup).toContain(">12 m²</text>");
  expect(markup).not.toContain("Hidden while merged");
  expect(markup).not.toContain("Unenclosed");
});

it("frames long room names and keeps XML-invalid characters in the plan only", () => {
  const plan = planOf([
    wall(0, 0, 80, 0, 10, "a"),
    wall(80, 0, 80, 80, 10, "b"),
    wall(80, 80, 0, 80, 10, "c"),
    wall(0, 80, 0, 0, 10, "d"),
  ]);
  const unnamed = buildExportSvg(plan);
  const wideName = "Ｗ".repeat(24);
  const name = `${wideName}\u0000\uD800\uFFFE🏠\r`;
  plan.roomNames = [{ anchor: { x: 40, y: 40 }, name }];
  const { markup, width, height } = buildExportSvg(plan);
  expect(width).toBeGreaterThan(unnamed.width);
  expect(width).toBeGreaterThan(wideName.length * 12);
  expect(height).toBe(unnamed.height);
  expect(markup).toContain(`${wideName}���🏠&#13;</text>`);
  expect(plan.roomNames[0].name).toBe(name);
});
