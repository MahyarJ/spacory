import type { Point, Wall } from "@app/schema";

// --- small vector helpers -------------------------------------------------
const sub = (p: Point, q: Point): Point => ({ x: p.x - q.x, y: p.y - q.y });
const add = (p: Point, q: Point): Point => ({ x: p.x + q.x, y: p.y + q.y });
const mul = (p: Point, k: number): Point => ({ x: p.x * k, y: p.y * k });

const unit = (p: Point): Point => {
  const L = Math.hypot(p.x, p.y) || 1;
  return { x: p.x / L, y: p.y / L };
};

/** Rotate a vector +90° (CCW): the "left" normal relative to its direction. */
const leftNormal = (t: Point): Point => ({ x: -t.y, y: t.x });

/**
 * Intersection of two infinite lines, each given as a point + direction.
 * Returns null when the lines are (near-)parallel.
 */
function lineIntersection(
  p1: Point,
  d1: Point,
  p2: Point,
  d2: Point,
  eps = 1e-9,
): Point | null {
  const det = d1.x * d2.y - d1.y * d2.x;
  if (Math.abs(det) < eps) return null;
  const s = ((p2.x - p1.x) * d2.y - (p2.y - p1.y) * d2.x) / det;
  return { x: p1.x + s * d1.x, y: p1.y + s * d1.y };
}

/**
 * Miter limit, expressed as a multiple of the (smaller) half-thickness at a
 * corner — the same ratio-to-stroke-width convention as SVG's
 * `stroke-miterlimit`. A miter point farther than this from the shared node
 * is replaced by a bevel (a flat edge along the two walls' own outer edges),
 * so very acute corners don't produce a long spike. 3 is a common default for
 * CAD/vector tools: generous enough to keep normal corners fully mitered,
 * tight enough to cap the spike at genuinely sharp angles.
 */
export const MITER_LIMIT = 3;

// Node matching precision (coordinates are in cm; 1e-3 groups coincident ends).
const QUANT = 1000;
const nodeKey = (p: Point): string =>
  `${Math.round(p.x * QUANT)}:${Math.round(p.y * QUANT)}`;

interface WallEnd {
  wallId: string;
  end: "a" | "b";
  node: Point;
  /** Unit tangent pointing away from the node, along the wall. */
  t: Point;
  /** Left normal of `t`. */
  nL: Point;
  /** Half thickness. */
  h: number;
  angle: number;
}

interface Corners {
  /** Corner on the +leftNormal side of this end's tangent. */
  left: Point;
  /** Corner on the −leftNormal side. */
  right: Point;
}

/** Four corners of a wall's rendered polygon, wound consistently. */
export type WallQuad = [Point, Point, Point, Point];

export interface WallGeometry {
  /** Per-wall mitered polygon, keyed by wall id. */
  walls: Map<string, WallQuad>;
  /**
   * Core fill polygons for junctions where 3+ walls meet. The mitered wall
   * quads leave the centre of such a junction open; each core polygon fills
   * exactly that region, sharing every edge with an adjacent wall's end.
   */
  junctions: Point[][];
}

/**
 * Compute wall render geometry, mitered so adjacent walls meet exactly at
 * shared nodes — no gaps, no overlapping cover patches. A wall end that isn't
 * shared (a free end, or a straight continuation where edges are parallel)
 * falls back to a square perpendicular cap.
 *
 * Only shared *endpoints* form junctions (matching the previous behaviour); a
 * wall ending mid-span of another is not auto-split.
 */
export function computeWallGeometry(walls: Wall[]): WallGeometry {
  // 1) Group every wall end by the node it sits on.
  const nodes = new Map<string, WallEnd[]>();
  const register = (e: WallEnd) => {
    const key = nodeKey(e.node);
    const arr = nodes.get(key);
    if (arr) arr.push(e);
    else nodes.set(key, [e]);
  };

  for (const w of walls) {
    const h = w.thickness / 2;
    const tAway = unit(sub(w.b, w.a)); // tangent away from node a
    register({
      wallId: w.id,
      end: "a",
      node: w.a,
      t: tAway,
      nL: leftNormal(tAway),
      h,
      angle: Math.atan2(tAway.y, tAway.x),
    });
    const tBack = mul(tAway, -1); // tangent away from node b
    register({
      wallId: w.id,
      end: "b",
      node: w.b,
      t: tBack,
      nL: leftNormal(tBack),
      h,
      angle: Math.atan2(tBack.y, tBack.x),
    });
  }

  // 2) Resolve the two corners of every wall end, and the core polygon of each
  //    multi-wall junction.
  const corners = new Map<string, Corners>();
  const junctions: Point[][] = [];
  const cornerKey = (e: Pick<WallEnd, "wallId" | "end">) =>
    `${e.wallId}:${e.end}`;

  // A miter point farther than this from the shared node is too long —
  // bevelled corners fall back to the wall's own (unextended) edge point.
  const tooLong = (miter: Point, node: Point, limit: number) =>
    Math.hypot(miter.x - node.x, miter.y - node.y) > limit;

  for (const ends of nodes.values()) {
    if (ends.length === 1) {
      // Free end: a plain perpendicular cap.
      const e = ends[0];
      corners.set(cornerKey(e), {
        left: add(e.node, mul(e.nL, e.h)),
        right: add(e.node, mul(e.nL, -e.h)),
      });
      continue;
    }

    const sorted = [...ends].sort((p, q) => p.angle - q.angle);
    const m = sorted.length;
    // The left corner of end k is the miter point of the wedge between end k
    // and its CCW neighbour; collected in angular order these bound the core.
    // A beveled wedge contributes its two base points instead of one miter
    // point, opening a small flat edge in the core fill's boundary.
    const wedgePoints: Point[] = [];
    // For a 2-wall corner there's no ring to fold a beveled wedge's extra
    // point into (only `m >= 3` forms one below), so each beveled wedge here
    // gets its own small triangular fill: the shared node plus the two
    // walls' own base points, closing the gap left between them.
    const twoWallFills: Point[][] = [];

    for (let k = 0; k < m; k++) {
      const e = sorted[k];
      const ccw = sorted[(k + 1) % m]; // neighbour to the +angle side
      const cw = sorted[(k - 1 + m) % m]; // neighbour to the −angle side

      const eLeftBase = add(e.node, mul(e.nL, e.h));
      const eRightBase = add(e.node, mul(e.nL, -e.h));
      const ccwRightBase = add(ccw.node, mul(ccw.nL, -ccw.h));
      const cwLeftBase = add(cw.node, mul(cw.nL, cw.h));

      // Left corner: this end's left edge meets the CCW neighbour's right edge.
      const leftMiter =
        lineIntersection(eLeftBase, e.t, ccwRightBase, ccw.t) ?? eLeftBase;
      const leftLimit = MITER_LIMIT * Math.min(e.h, ccw.h);
      const leftBeveled = tooLong(leftMiter, e.node, leftLimit);
      const left = leftBeveled ? eLeftBase : leftMiter;

      // Right corner: this end's right edge meets the CW neighbour's left edge.
      const rightMiter =
        lineIntersection(eRightBase, e.t, cwLeftBase, cw.t) ?? eRightBase;
      const rightLimit = MITER_LIMIT * Math.min(e.h, cw.h);
      const rightBeveled = tooLong(rightMiter, e.node, rightLimit);
      const right = rightBeveled ? eRightBase : rightMiter;

      corners.set(cornerKey(e), { left, right });
      wedgePoints.push(left);
      if (leftBeveled) {
        wedgePoints.push(ccwRightBase);
        if (m === 2) twoWallFills.push([e.node, left, ccwRightBase]);
      }
    }

    // With 3+ walls the wedge points enclose an open core; fill it — a
    // beveled wedge just contributes an extra point, flattening that corner
    // of the core without opening a gap. With exactly 2 walls there's no
    // ring to fold into, so a beveled wedge instead gets its own small
    // triangular fill (`twoWallFills`) closing the same kind of gap.
    if (m >= 3) junctions.push(wedgePoints);
    else junctions.push(...twoWallFills);
  }

  // 3) Assemble each wall's quad. "left/right" are relative to each end's own
  //    tangent, which points opposite ways at a and b — so b's left/right map
  //    to the opposite physical sides from a's.
  const wallPolys = new Map<string, WallQuad>();
  for (const w of walls) {
    const a = corners.get(`${w.id}:a`);
    const b = corners.get(`${w.id}:b`);
    if (!a || !b) continue;
    wallPolys.set(w.id, [a.left, b.right, b.left, a.right]);
  }

  return { walls: wallPolys, junctions };
}

/** Serialize a polygon's points to an SVG `points` string. */
export const polygonToPoints = (poly: readonly Point[]): string =>
  poly.map((p) => `${p.x},${p.y}`).join(" ");
