import type { Item, Point, Wall } from "@app/schema";
import { findConnectedEndpoints, pointsEqual } from "./connectivity";
import { getWallLength } from "./wall";

/**
 * Merging two collinear walls back into one — the cleanup counterpart of
 * `wallSplit.ts`.
 *
 * Splitting a host where another wall ends on it is what makes a mid-span
 * T-junction real, but nothing undoes it once the reason is gone: delete or
 * detach the T-wall and the host is left as two collinear segments joined at a
 * junction that no longer means anything — two length labels, two selectable
 * halves, a draggable seam — where the user sees one straight wall.
 *
 * The merge is deliberately *not* a global "collapse every collinear 2-wall
 * junction" invariant: a click-to-chain straight run creates exactly that
 * arrangement on purpose. It only looks at coordinates the commit **vacated** —
 * where an endpoint that used to sit there no longer does — so an edit that
 * *adds* an endpoint never merges anything.
 */

const ENDS = ["a", "b"] as const;

/**
 * How far off-straight two walls may be and still merge, as the sine of the
 * angle between them. Only float noise is tolerated: a split point is the exact
 * projection onto the host's centreline, so two segments of one wall are
 * collinear to ~1e-13, while walls a user drew even a degree apart
 * (sin 1° ≈ 0.017) stay separate — merging those would visibly bend the wall.
 */
const COLLINEAR_EPS = 1e-6;

export interface WallMergeResult {
  walls: Wall[];
  items: Item[];
  /**
   * Every seam coordinate the merge removed. Empty when nothing merged, which
   * is the common case on most commits.
   */
  mergedPoints: Point[];
}

/**
 * The two walls meeting at a seam, oriented for the merge: `keep` provides the
 * merged wall's id and direction, `drop` disappears into it.
 */
interface MergePair {
  keep: Wall;
  drop: Wall;
}

/**
 * Coordinates that fewer wall endpoints sit on now than before — the seams this
 * edit could have made meaningless, because an endpoint was deleted or moved
 * away from them. Deciding this needs both plans, which is why the merge lives
 * in `commit()`: it holds the previous plan and the next one.
 */
export function findVacatedPoints(before: Wall[], after: Wall[]): Point[] {
  const vacated: Point[] = [];
  for (const w of before) {
    for (const end of ENDS) {
      const p = w[end];
      if (vacated.some((q) => pointsEqual(q, p))) continue;
      const was = findConnectedEndpoints(before, p).length;
      if (findConnectedEndpoints(after, p).length < was) vacated.push(p);
    }
  }
  return vacated;
}

/**
 * Merge the two walls meeting at each seam this edit vacated, back into one
 * wall, rebasing any opening onto it so it keeps its world position.
 *
 * Pure. Returns the input arrays unchanged (same identity) when nothing
 * qualifies — the common case on most commits.
 */
export function mergeWallsAtVacatedSeams(
  before: Wall[],
  walls: Wall[],
  items: Item[],
): WallMergeResult {
  const vacated = findVacatedPoints(before, walls);
  if (vacated.length === 0) return { walls, items, mergedPoints: [] };
  let result = { walls, items };
  const mergedPoints: Point[] = [];
  for (const at of vacated) {
    // Re-query the running result, not the input: a run of segments (two walls
    // splitting one host, both deleted at once) vacates several seams, and
    // merging the first one changes which wall the next seam belongs to. That
    // collapses the whole run in one step rather than pairwise.
    const pair = findMergePairAt(result.walls, at);
    if (!pair) continue;
    result = applyMerge(result, pair, at);
    mergedPoints.push(at);
  }
  return { ...result, mergedPoints };
}

/**
 * The mergeable pair at `at`, or `null` when the seam is meaningful and must be
 * left alone. Mergeable means *all* of: exactly two wall endpoints meet there
 * (a 3-wall junction is a real junction), they belong to two different walls,
 * they carry the same `thickness` (visibly different walls otherwise), and the
 * two walls continue straight *through* the point — collinear and in the same
 * direction, so the merged wall covers exactly the span the two did. Two walls
 * folding back over each other are collinear but overlap the same span, which is
 * the overlap family, not a seam.
 */
function findMergePairAt(walls: Wall[], at: Point): MergePair | null {
  const refs = findConnectedEndpoints(walls, at);
  if (refs.length !== 2) return null;
  if (refs[0].wallId === refs[1].wallId) return null;
  // `findConnectedEndpoints` walks the array, so the first ref is the earlier
  // wall: it keeps its id and direction, so a selected wall stays selected and
  // its openings' offsets stay measured from the same end.
  const keep = walls.find((w) => w.id === refs[0].wallId);
  const drop = walls.find((w) => w.id === refs[1].wallId);
  if (!keep || !drop) return null;
  if (keep.thickness !== drop.thickness) return null;
  const outKeep = directionAwayFrom(keep, at);
  const outDrop = directionAwayFrom(drop, at);
  if (!outKeep || !outDrop) return null;
  // The two walls leave the seam in *opposite* directions when they continue
  // through it; the same direction means they fold back over one another.
  const cross = outKeep.x * outDrop.y - outKeep.y * outDrop.x;
  if (Math.abs(cross) > COLLINEAR_EPS) return null;
  if (outKeep.x * outDrop.x + outKeep.y * outDrop.y >= 0) return null;
  return { keep, drop };
}

/** Unit vector from `at` towards the wall's other end, or `null` if degenerate. */
function directionAwayFrom(w: Wall, at: Point): Point | null {
  const far = pointsEqual(w.a, at) ? w.b : w.a;
  const len = Math.hypot(far.x - at.x, far.y - at.y);
  if (len === 0) return null;
  return { x: (far.x - at.x) / len, y: (far.y - at.y) / len };
}

/** One wall's contribution to the merged wall, in merged-wall order. */
interface Leg {
  wall: Wall;
  /** Does the wall's own `a` → `b` run *against* the merged wall's direction? */
  reversed: boolean;
}

function applyMerge(
  { walls, items }: { walls: Wall[]; items: Item[] },
  { keep, drop }: MergePair,
  at: Point,
): { walls: Wall[]; items: Item[] } {
  // `keep` keeps its direction, so the merged wall extends past whichever of its
  // ends the seam is on: `drop` comes before it when the seam is `keep.a`.
  const dropFirst = pointsEqual(keep.a, at);
  const legFor = (w: Wall, comesFirst: boolean): Leg => ({
    wall: w,
    // A leg that comes first is traversed *towards* the seam, the second one
    // away from it — so which of its own ends sits on the seam decides whether
    // it runs with or against the merged direction.
    reversed: comesFirst ? pointsEqual(w.a, at) : !pointsEqual(w.a, at),
  });
  const legs: [Leg, Leg] = dropFirst
    ? [legFor(drop, true), legFor(keep, false)]
    : [legFor(keep, true), legFor(drop, false)];
  const start = legs[0].reversed ? legs[0].wall.b : legs[0].wall.a;
  const end = legs[1].reversed ? legs[1].wall.a : legs[1].wall.b;
  const merged: Wall = { ...keep, a: start, b: end };

  const firstLength = getWallLength(legs[0].wall);
  const mergedLength = firstLength + getWallLength(legs[1].wall);
  /** Where each leg's own `offset` scale starts along the merged wall. */
  const bases = new Map<string, { base: number; leg: Leg }>([
    [legs[0].wall.id, { base: 0, leg: legs[0] }],
    [legs[1].wall.id, { base: firstLength, leg: legs[1] }],
  ]);

  return {
    // The merged wall takes `keep`'s place, so z-order is as stable as it can be.
    walls: walls
      .filter((w) => w.id !== drop.id)
      .map((w) => (w.id === keep.id ? merged : w)),
    items: items.map((item) => {
      const on = bases.get(item.wallAttach.wallId);
      if (!on) return item;
      const { offset, length } = item.wallAttach;
      const own = getWallLength(on.leg.wall);
      // Measured from the merged wall's `a`: a reversed leg's offsets run the
      // other way, so the opening's distance from the seam-side end is what
      // carries over. Either way the opening's world position is unchanged.
      const rebased = on.leg.reversed
        ? on.base + (own - offset - length)
        : on.base + offset;
      return {
        ...item,
        wallAttach: {
          ...item.wallAttach,
          wallId: merged.id,
          offset: Math.max(0, Math.min(rebased, mergedLength - length)),
        },
      };
    }),
  };
}
