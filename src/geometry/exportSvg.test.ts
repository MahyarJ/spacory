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

  it("draws and frames a resized, rotated sink beyond the wall footprint", () => {
    const { markup, width, height } = buildExportSvg({
      ...planOf([wall(0, 0, 100, 0)]),
      fixtures: [
        {
          id: "fixture",
          type: "sink",
          position: { x: 200, y: 80 },
          width: 100,
          depth: 40,
          rotation: 45,
        },
      ],
    });
    const reach = 70 / Math.sqrt(2) + 0.75;
    expect(width).toBeCloseTo(205 + reach + 2 * EXPORT_MARGIN);
    expect(height).toBeCloseTo(85 + reach + 2 * EXPORT_MARGIN);
    expect(markup).toContain(
      'data-fixture="sink" transform="translate(200 80) rotate(45)"',
    );
    expect(markup).toContain('<rect x="-50" y="-20" width="100" height="40"');
    expect(markup).toMatch(/data-fixture="sink".*<rect.*<rect.*<circle.*<path/);
    expect(markup).not.toContain("data-fixture-selection");
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

it.each([
  { wallLengths: true, roomAreas: true },
  { wallLengths: true, roomAreas: false },
  { wallLengths: false, roomAreas: true },
  { wallLengths: false, roomAreas: false },
])("toggles only measurement text (lengths $wallLengths, areas $roomAreas)", (visibility) => {
  const plan = planOf(
    [
      wall(0, 0, 400, 0, 10, "a"),
      wall(400, 0, 400, 300, 10, "b"),
      wall(400, 300, 0, 300, 10, "c"),
      wall(0, 300, 0, 0, 10, "d"),
      wall(400, 0, 600, 0, 10, "e"),
      wall(600, 0, 600, 300, 10, "f"),
      wall(600, 300, 400, 300, 10, "g"),
    ],
    [doorItem("a")],
  );
  plan.roomNames = [{ anchor: { x: 200, y: 150 }, name: "Kitchen & dining" }];
  plan.labels = [
    { id: "terrace", position: { x: 50, y: -50 }, text: "Terrace" },
  ];

  const expected = buildExportSvg(plan);
  const result = buildExportSvg(
    plan,
    undefined,
    undefined,
    undefined,
    visibility,
  );
  let markup = expected.markup;
  if (!visibility.wallLengths) {
    markup = markup.replace(/(<g data-layer="dimensions">).*?(<\/g>)/, "$1$2");
  }
  if (!visibility.roomAreas) {
    markup = markup.replaceAll(/<text [^>]*>(?:12|6) m²<\/text>/g, "");
  }
  expect(result).toEqual({ ...expected, markup });
  expect(result.markup.includes(">400 cm</text>")).toBe(visibility.wallLengths);
  expect(result.markup.includes(">12 m²</text>")).toBe(visibility.roomAreas);
  expect(result.markup.includes(">6 m²</text>")).toBe(visibility.roomAreas);
  expect(result.markup).toContain(">Kitchen &amp; dining</text>");
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
  expect(markup).toContain(">Cuisine &amp; 茶室 &lt;🏠&gt;</text>");
  expect(markup).toContain('>"special"</text>');
  expect(markup).toContain(">12 m²</text>");
  expect(markup).not.toContain("Hidden while merged");
  expect(markup).not.toContain("Unenclosed");
});

it("replaces XML-invalid display characters while preserving the saved text", () => {
  const plan = planOf([
    wall(0, 0, 400, 0, 10, "a"),
    wall(400, 0, 400, 300, 10, "b"),
    wall(400, 300, 0, 300, 10, "c"),
    wall(0, 300, 0, 0, 10, "d"),
  ]);
  const name = "Room\u0000\uD800\uFFFE🏠\r";
  plan.roomNames = [{ anchor: { x: 100, y: 150 }, name }];
  expect(buildExportSvg(plan).markup).toContain("Room���🏠&#13;</text>");
  expect(plan.roomNames[0].name).toBe(name);
});

it("exports an outdoor label with room for the full glyph extents and stroke", () => {
  const plan = planOf([wall(0, 0, 100, 0)]);
  const text = '  Terrace & 茶室 <🌿> "outside"  ';
  plan.labels = [{ id: "terrace", position: { x: 500, y: -200 }, text }];
  const measure = (line: string) => {
    expect(line).toBe(text);
    return {
      width: 240,
      actualBoundingBoxLeft: -10,
      actualBoundingBoxRight: 260,
      actualBoundingBoxAscent: 35,
      actualBoundingBoxDescent: 20,
    } as TextMetrics;
  };
  // Use zero margin to ensure the label's own bounds are sufficient.
  const { markup, width, height } = buildExportSvg(plan, 0, undefined, measure);
  expect(width).toBe(767.5);
  expect(height).toBe(242.5);
  expect(markup).toContain('viewBox="-5 -237.5 767.5 242.5"');
  expect(markup).toContain(
    '<g data-layer="plan-labels"><text x="500" y="-200" xml:space="preserve" font-family="system-ui, sans-serif" font-size="28" font-weight="600" text-anchor="start"',
  );
  expect(markup).toContain(
    '>  Terrace &amp; 茶室 &lt;🌿&gt; "outside"  </text>',
  );
});

it("frames a label-only plan around the label", () => {
  const plan = planOf([]);
  plan.labels = [
    {
      id: "terrace",
      position: { x: 500, y: 500 },
      text: "Terrace",
    },
  ];
  const { markup, width, height } = buildExportSvg(plan, 0);
  expect(width).toBe(299);
  expect(height).toBe(47);
  expect(markup).toContain('viewBox="497.5 469.5 299 47"');
  expect(markup).toContain('text-anchor="start"');
});

it("keeps image dimensions independent of room names and abbreviates long visible labels", () => {
  const plan = planOf([
    wall(0, 0, 180, 0, 10, "a"),
    wall(180, 0, 180, 320, 10, "b"),
    wall(180, 320, 0, 320, 10, "c"),
    wall(0, 320, 0, 0, 10, "d"),
  ]);
  const unnamed = buildExportSvg(plan);
  const name = "A".repeat(6000);
  plan.roomNames = [{ anchor: { x: 90, y: 160 }, name }];
  const { markup, width, height } = buildExportSvg(plan);
  expect(width).toBe(unnamed.width);
  expect(height).toBe(unnamed.height);
  expect(markup).toContain(`<title>${name}</title>`);
  expect(markup).toMatch(/font-weight="600"[^>]*>A+…<\/text>/);
  expect(markup).toContain(">5.76 m²</text>");
  expect(plan.roomNames[0].name).toBe(name);
});

it("fits the full saved room name at a smaller size in a 120 cm square", () => {
  const plan = planOf([
    wall(0, 0, 120, 0, 10, "a"),
    wall(120, 0, 120, 120, 10, "b"),
    wall(120, 120, 0, 120, 10, "c"),
    wall(0, 120, 0, 0, 10, "d"),
  ]);
  plan.roomNames = [{ anchor: { x: 60, y: 60 }, name: "Storage room" }];

  const { markup } = buildExportSvg(plan);
  const visibleName = [
    ...markup.matchAll(/font-weight="600"[^>]*>([^<]+)<\/text>/g),
  ]
    .map(([, line]) => line)
    .join(" ");
  expect(visibleName).toBe("Storage room");
  expect(markup).toMatch(/<g transform="translate\([^)]+\) scale\(0\.\d+\)"/);
  expect(markup).toContain(">1.44 m²</text>");
});

it("uses measured glyph widths to wrap labels at their natural proportions", () => {
  const plan = planOf([
    wall(0, 0, 180, 0, 10, "a"),
    wall(180, 0, 180, 320, 10, "b"),
    wall(180, 320, 0, 320, 10, "c"),
    wall(0, 320, 0, 0, 10, "d"),
  ]);
  plan.roomNames = [{ anchor: { x: 90, y: 160 }, name: "Vestibule storage" }];
  const { markup } = buildExportSvg(
    plan,
    undefined,
    (text, weight) => text.length * (weight === 600 ? 12 : 6),
  );
  expect(markup).toContain(">Vestibule</text>");
  expect(markup).toContain(">storage</text>");
  expect(markup).toContain(">5.76 m²</text>");
  expect(markup).not.toMatch(/textLength=|lengthAdjust=/);
});

it("preserves the name in the SVG title when walls fill the entire face", () => {
  const plan = planOf([
    wall(0, 0, 80, 0, 100, "a"),
    wall(80, 0, 80, 80, 100, "b"),
    wall(80, 80, 0, 80, 100, "c"),
    wall(0, 80, 0, 0, 100, "d"),
  ]);
  plan.roomNames = [{ anchor: { x: 40, y: 40 }, name: "Coats & linen" }];
  const { markup } = buildExportSvg(plan);
  expect(markup).toContain("<title>Coats &amp; linen</title>");
  expect(markup).not.toContain('font-weight="600"');
  expect(markup).toContain(">0.64 m²</text>");
});
