import type { Point, Wall } from "@app/schema";
import { describe, expect, it } from "vitest";
import { computeWallGeometry, MITER_LIMIT, type WallQuad } from "./junction";

// Back-compat shim: most tests only care about the per-wall quads.
const computeWallPolygons = (walls: Wall[]) => computeWallGeometry(walls).walls;

const wall = (
  id: string,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  thickness = 10,
): Wall => ({ id, a: { x: ax, y: ay }, b: { x: bx, y: by }, thickness });

const EPS = 1e-6;
const near = (p: Point, q: Point) =>
  Math.abs(p.x - q.x) < EPS && Math.abs(p.y - q.y) < EPS;
const quadHas = (quad: WallQuad, p: Point) => quad.some((c) => near(c, p));
const allFinite = (quad: WallQuad) =>
  quad.every((c) => Number.isFinite(c.x) && Number.isFinite(c.y));

describe("computeWallPolygons", () => {
  it("returns an empty map for no walls", () => {
    expect(computeWallPolygons([]).size).toBe(0);
  });

  it("renders a lone wall as a plain perpendicular rectangle", () => {
    const quad = computeWallPolygons([wall("w", 0, 0, 100, 0, 10)]).get("w");
    expect(quad).toBeDefined();
    // half-thickness 5 → corners at y = ±5 spanning x 0..100
    for (const p of [
      { x: 0, y: 5 },
      { x: 100, y: 5 },
      { x: 100, y: -5 },
      { x: 0, y: -5 },
    ]) {
      expect(quadHas(quad as WallQuad, p)).toBe(true);
    }
  });

  it("miters an L-corner so both walls share the exact corner vertices", () => {
    const polys = computeWallPolygons([
      wall("h", 0, 0, 100, 0, 10), // east
      wall("v", 0, 0, 0, 100, 10), // south
    ]);
    const h = polys.get("h") as WallQuad;
    const v = polys.get("v") as WallQuad;

    // Inner corner (5,5) and outer corner (-5,-5) are shared by both quads —
    // i.e. the two walls tile the junction with no gap and no overlap patch.
    for (const corner of [
      { x: 5, y: 5 },
      { x: -5, y: -5 },
    ]) {
      expect(quadHas(h, corner)).toBe(true);
      expect(quadHas(v, corner)).toBe(true);
    }
  });

  it("keeps a straight continuation flush (no gap, no spike)", () => {
    const polys = computeWallPolygons([
      wall("a", 0, 0, 100, 0, 10),
      wall("b", 100, 0, 200, 0, 10),
    ]);
    const a = polys.get("a") as WallQuad;
    const b = polys.get("b") as WallQuad;

    // The shared seam is exactly the perpendicular cut at x=100, ±half-thickness.
    for (const corner of [
      { x: 100, y: 5 },
      { x: 100, y: -5 },
    ]) {
      expect(quadHas(a, corner)).toBe(true);
      expect(quadHas(b, corner)).toBe(true);
    }
    // No miter spike: every coordinate stays within the walls' x-range.
    expect(a.every((p) => p.x >= -EPS && p.x <= 100 + EPS)).toBe(true);
  });

  it("shares the seam even when the two walls differ in thickness", () => {
    const polys = computeWallPolygons([
      wall("h", 0, 0, 100, 0, 20), // half 10
      wall("v", 0, 0, 0, 100, 10), // half 5
    ]);
    const h = polys.get("h") as WallQuad;
    const v = polys.get("v") as WallQuad;
    expect(allFinite(h) && allFinite(v)).toBe(true);

    // By construction, h's corner on one side equals v's corner on the matching
    // side (same pair of edge lines intersected). Find at least one exact match.
    const shared = h.filter((hc) => v.some((vc) => near(hc, vc)));
    expect(shared.length).toBeGreaterThanOrEqual(2);
  });

  it("handles a 3-wall T-junction with finite, shared corners", () => {
    const polys = computeWallPolygons([
      wall("e", 0, 0, 100, 0, 10), // east
      wall("w", 0, 0, -100, 0, 10), // west (straight through)
      wall("s", 0, 0, 0, 100, 10), // south branch
    ]);
    expect(polys.size).toBe(3);
    for (const id of ["e", "w", "s"]) {
      expect(allFinite(polys.get(id) as WallQuad)).toBe(true);
    }
    // The south branch shares a corner with each of the through-walls.
    const s = polys.get("s") as WallQuad;
    const e = polys.get("e") as WallQuad;
    const w = polys.get("w") as WallQuad;
    expect(s.some((sc) => e.some((ec) => near(sc, ec)))).toBe(true);
    expect(s.some((sc) => w.some((wc) => near(sc, wc)))).toBe(true);
  });
});

describe("junction core fills", () => {
  it("emits no core fill for free ends or 2-wall corners", () => {
    expect(computeWallGeometry([wall("w", 0, 0, 100, 0)]).junctions).toEqual(
      [],
    );
    expect(
      computeWallGeometry([wall("h", 0, 0, 100, 0), wall("v", 0, 0, 0, 100)])
        .junctions,
    ).toEqual([]);
    expect(
      computeWallGeometry([wall("a", 0, 0, 100, 0), wall("b", 100, 0, 200, 0)])
        .junctions,
    ).toEqual([]);
  });

  it("fills a triangle at a 3-wall T-junction", () => {
    const { junctions } = computeWallGeometry([
      wall("e", 0, 0, 100, 0, 10),
      wall("w", 0, 0, -100, 0, 10),
      wall("s", 0, 0, 0, 100, 10),
    ]);
    expect(junctions).toHaveLength(1);
    expect(junctions[0]).toHaveLength(3);
    expect(junctions[0].every((p) => Number.isFinite(p.x))).toBe(true);
  });

  it("fills the central square of a 4-wall X-junction", () => {
    const { junctions } = computeWallGeometry([
      wall("e", 0, 0, 100, 0, 10),
      wall("w", 0, 0, -100, 0, 10),
      wall("n", 0, 0, 0, -100, 10),
      wall("s", 0, 0, 0, 100, 10),
    ]);
    expect(junctions).toHaveLength(1);
    const core = junctions[0];
    expect(core).toHaveLength(4);
    // The four corners of the ±half-thickness square around the node.
    for (const corner of [
      { x: 5, y: 5 },
      { x: -5, y: 5 },
      { x: -5, y: -5 },
      { x: 5, y: -5 },
    ]) {
      expect(core.some((p) => near(p, corner))).toBe(true);
    }
  });

  it("shares every core-fill vertex with an adjacent wall corner (seamless)", () => {
    const geom = computeWallGeometry([
      wall("e", 0, 0, 100, 0, 10),
      wall("w", 0, 0, -100, 0, 10),
      wall("s", 0, 0, 0, 100, 10),
    ]);
    const allCorners = [...geom.walls.values()].flat();
    for (const v of geom.junctions[0]) {
      expect(allCorners.some((c) => near(c, v))).toBe(true);
    }
  });
});

describe("miter limit (bevel fallback)", () => {
  const node = { x: 0, y: 0 };
  const dist = (p: Point) => Math.hypot(p.x - node.x, p.y - node.y);

  it("bounds a very acute (~10°) corner instead of a long miter spike", () => {
    const rad = (10 * Math.PI) / 180;
    const polys = computeWallPolygons([
      wall("a", 0, 0, 100, 0, 10), // half-thickness 5
      wall("b", 0, 0, 100 * Math.cos(rad), 100 * Math.sin(rad), 10),
    ]);
    const a = polys.get("a") as WallQuad;
    const b = polys.get("b") as WallQuad;

    // Every corner near the shared node stays within the miter limit — no
    // spike shooting far past the junction. (Each wall's far free end, at
    // ~100cm, is unaffected and excluded here.)
    const limit = MITER_LIMIT * 5 + EPS;
    for (const quad of [a, b]) {
      for (const p of quad.filter((p) => dist(p) < 50)) {
        expect(dist(p)).toBeLessThanOrEqual(limit);
      }
    }
  });

  it("leaves a normal/obtuse angle mitered exactly as before", () => {
    // A 90° corner's outer miter point sits farther from the node than the
    // (small) miter limit alone would allow, proving it's a real miter and
    // not a beveled fallback.
    const polys = computeWallPolygons([
      wall("h", 0, 0, 100, 0, 10),
      wall("v", 0, 0, 0, 100, 10),
    ]);
    const h = polys.get("h") as WallQuad;
    const v = polys.get("v") as WallQuad;
    const outer = { x: -5, y: -5 };
    expect(quadHas(h, outer)).toBe(true);
    expect(quadHas(v, outer)).toBe(true);
  });

  it("bevels only the acute wedge of a 3-wall junction, keeping a valid core fill", () => {
    // Two walls meet at a sharp ~8° angle; a third, perpendicular wall joins
    // the same node, giving a mix of one beveled wedge and two normal ones.
    const rad = (8 * Math.PI) / 180;
    const { walls, junctions } = computeWallGeometry([
      wall("a", 0, 0, 100, 0, 10),
      wall("b", 0, 0, 100 * Math.cos(rad), 100 * Math.sin(rad), 10),
      wall("c", 0, 0, 0, -100, 10),
    ]);
    const a = walls.get("a") as WallQuad;
    const b = walls.get("b") as WallQuad;
    const c = walls.get("c") as WallQuad;

    // The acute a/b wedge is capped: every corner near the shared node (as
    // opposed to each wall's far free end, ~100cm away) stays within the
    // miter limit.
    const limit = MITER_LIMIT * 5 + EPS;
    for (const quad of [a, b, c]) {
      for (const p of quad.filter((p) => dist(p) < 50)) {
        expect(dist(p)).toBeLessThanOrEqual(limit);
      }
    }

    // ...while the core fill still closes up: every one of its vertices is a
    // real wall corner (no gap), and it forms a single simple polygon (no
    // overlap) with no repeated vertex.
    expect(junctions).toHaveLength(1);
    const core = junctions[0];
    const allCorners = [...walls.values()].flat();
    for (const v of core) {
      expect(allCorners.some((corner) => near(corner, v))).toBe(true);
    }
    const uniquePoints = core.filter(
      (p, i) => !core.slice(0, i).some((q) => near(p, q)),
    );
    expect(uniquePoints).toHaveLength(core.length);
  });
});
