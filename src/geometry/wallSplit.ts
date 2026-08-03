import type { Item, Point, Wall } from "@app/schema";
import { pointsEqual, type WallEndpointRef } from "./connectivity";
import { getWallLength, MIN_WALL_LENGTH, projectPointToWall } from "./wall";

/**
 * Splitting walls where another wall's endpoint lands mid-span.
 *
 * Connectivity in this app is purely coordinate equality between wall
 * *endpoints* (see `connectivity.ts`), so a wall ending part-way along another
 * only *looks* joined: it gets no mitered junction, doesn't follow the host when
 * it moves, and isn't picked up by a junction drag. Splitting the host at that
 * point turns the visual T into a real three-endpoint junction that every
 * existing feature already understands — no new concept enters the data model.
 */

const ENDS = ["a", "b"] as const;

/**
 * A detected "this endpoint lands on that wall's span" touch, resolved against
 * one host.
 */
interface Touch {
  hostId: string;
  /** Distance along the host from its `a` to the projected point. */
  offset: number;
  /** Perpendicular distance from the endpoint to the host's centreline. */
  distance: number;
  /** The endpoint's projection onto the host — where both will be welded. */
  point: Point;
  toucher: WallEndpointRef;
}

/**
 * A coordinate the split moved: `from` is where it sat before, `to` is the
 * split point it was welded onto. Callers holding a plan coordinate (the store
 * tracks the selected junction as one) can follow it across the commit.
 */
export interface PointWeld {
  from: Point;
  to: Point;
}

export interface WallSplitResult {
  walls: Wall[];
  items: Item[];
  /**
   * Every coordinate the split moved, composed across passes so `from` is
   * always a coordinate as the caller knew it *before* the split. Empty when
   * nothing was welded.
   */
  welds: PointWeld[];
}

/**
 * Follow `point` through a split's welds: the coordinate it now sits at, or
 * `point` itself when the split left it alone.
 */
export function resolveWeldedPoint(welds: PointWeld[], point: Point): Point {
  return welds.find((w) => pointsEqual(w.from, point))?.to ?? point;
}

/**
 * Cap on detect→apply rounds. One round normally settles the whole plan; the
 * loop exists for the rare endpoint that lands inside *two* walls' bodies at
 * once, which can only be welded onto one of them per round, and for the
 * touches a pass defers because their host moves (see `applyTouches`).
 */
const MAX_PASSES = 8;

const endpointKey = (ref: WallEndpointRef) => `${ref.wallId}:${ref.end}`;

/** Do these two walls already meet at a shared endpoint coordinate? */
const shareAJunction = (w: Wall, other: Wall) =>
  ENDS.some((end) => ENDS.some((o) => pointsEqual(w[end], other[o])));

/**
 * Split every wall that another wall's endpoint ends on, welding the touching
 * endpoint exactly onto the split point, and re-attach the host's openings to
 * whichever segment now holds them.
 *
 * Pure — `nextWallId` is injected so the caller owns id generation and tests
 * stay deterministic. Returns the input arrays unchanged (same identity) when
 * nothing qualifies, which is the common case on most commits.
 */
export function splitWallsAtTouchingEndpoints(
  walls: Wall[],
  items: Item[],
  nextWallId: () => string,
): WallSplitResult {
  let result: WallSplitResult = { walls, items, welds: [] };
  let touches = detectTouches(walls);
  for (let pass = 0; pass < MAX_PASSES && touches.length > 0; pass++) {
    const applied = applyTouches(result, touches, nextWallId);
    // A pass that deferred everything (see `applyTouches`) would only repeat
    // itself, since the next detect runs on identical geometry.
    if (
      applied.welds.length === 0 &&
      applied.walls.length === result.walls.length
    ) {
      break;
    }
    result = { ...applied, welds: composeWelds(result.welds, applied.welds) };
    touches = detectTouches(result.walls);
  }
  // All or nothing: keep the run's result only if the plan settled and the
  // split left behind neither a sub-minimum wall nor a coincident pair. A weld
  // moves an endpoint, so on thick walls — the band is `host.thickness / 2`,
  // 20cm at the widest preset — a pass can drag a whole junction into another
  // wall's body and leave more touches than it resolved. Those grind the
  // neighbourhood into slivers, and being unsettled they grind *again* on the
  // next commit, so the plan keeps growing.
  //
  // Judging the outcome here, rather than adding a per-touch guard for each
  // arrangement that can reach a bad one, makes the properties #96 states
  // unconditionally structural: no split produces a sub-`MIN_WALL_LENGTH`
  // wall, no split produces two walls on one span, and a plan the split has
  // been through never changes on a later commit (a settled result re-detects
  // no touches; a discarded one is returned untouched, so the next commit
  // reaches the same verdict). A discarded run leaves those walls merely
  // looking joined without being so — what they did before this module
  // existed — the same fallback the overlap guards in `detectTouches` take.
  // `result.walls === walls` on the common commit, where nothing touched at
  // all; there is nothing to judge and no reason to pay for the scan.
  if (result.walls === walls) return result;
  const settled = touches.length === 0 && !isWorse(walls, result.walls);
  return settled ? result : { walls, items, welds: [] };
}

/**
 * Did the split leave a sub-`MIN_WALL_LENGTH` wall, or two walls spanning the
 * same pair of coordinates, that the plan didn't already have?
 */
function isWorse(before: Wall[], after: Wall[]): boolean {
  const shortCount = (ws: Wall[]) =>
    ws.filter((w) => getWallLength(w) < MIN_WALL_LENGTH).length;
  if (shortCount(after) > shortCount(before)) return true;
  const duplicateCount = (ws: Wall[]) =>
    ws.filter((w, i) =>
      ws.some(
        (o, j) =>
          j < i &&
          ((pointsEqual(w.a, o.a) && pointsEqual(w.b, o.b)) ||
            (pointsEqual(w.a, o.b) && pointsEqual(w.b, o.a))),
      ),
    ).length;
  return duplicateCount(after) > duplicateCount(before);
}

/**
 * Chain a pass's welds onto the ones already collected, so an endpoint welded
 * twice (it sat inside two walls' bodies) still maps from its *original*
 * coordinate to where it finally landed.
 */
function composeWelds(acc: PointWeld[], passWelds: PointWeld[]): PointWeld[] {
  if (passWelds.length === 0) return acc;
  const composed = acc.map((w) => {
    const onward = passWelds.find((p) => pointsEqual(p.from, w.to));
    return onward ? { from: w.from, to: onward.to } : w;
  });
  for (const p of passWelds) {
    if (!composed.some((w) => pointsEqual(w.from, p.from))) composed.push(p);
  }
  return composed;
}

/**
 * Every wall endpoint that lands *inside another wall's drawn body* — within
 * `host.thickness / 2` of its centreline, so "if it looks like it touches, it
 * connects" — and far enough from the host's own endpoints that splitting there
 * can't produce a sub-`MIN_WALL_LENGTH` sliver. An endpoint near a host's own
 * end is an ordinary corner and is left alone (welding near-miss corners is a
 * separate concern). At most one touch per endpoint: if it sits inside two
 * walls at once, the nearer host wins and the next pass reconsiders the other.
 */
function detectTouches(walls: Wall[]): Touch[] {
  const touches: Touch[] = [];
  for (const w of walls) {
    const ends: Touch[] = [];
    for (const end of ENDS) {
      let best: Touch | null = null;
      for (const host of walls) {
        if (host.id === w.id) continue;
        // Already joined at a corner: a further touch between the same pair is
        // the two lying over each other, not a new T. Welding it would leave a
        // second wall spanning the junctions they already share.
        if (shareAJunction(w, host)) continue;
        const { distance, offset, proj } = projectPointToWall(w[end], host);
        if (distance > host.thickness / 2) continue;
        const hostLength = getWallLength(host);
        if (offset < MIN_WALL_LENGTH) continue;
        if (hostLength - offset < MIN_WALL_LENGTH) continue;
        // Welding moves the endpoint; don't let that collapse the toucher.
        const other = w[end === "a" ? "b" : "a"];
        if (Math.hypot(proj.x - other.x, proj.y - other.y) < MIN_WALL_LENGTH) {
          continue;
        }
        if (best === null || distance < best.distance) {
          best = {
            hostId: host.id,
            offset,
            distance,
            point: proj,
            toucher: { wallId: w.id, end },
          };
        }
      }
      if (best) ends.push(best);
    }
    // Both ends inside the *same* host isn't a T — the wall lies along that
    // host's body, which is the crossing/overlap family this module leaves
    // alone. Welding both would collapse it onto the centreline: to zero length
    // when it crosses the host, or onto a duplicate of the host's own span when
    // it runs alongside. Skip the wall entirely, host left un-split.
    if (ends.length === 2 && ends[0].hostId === ends[1].hostId) continue;
    touches.push(...ends);
  }
  // A *mutual* touch — each of two walls ending inside the other's body — is
  // the same overlap family seen from both sides, not a pair of Ts. Applying it
  // welds one wall onto the other's centreline, which moves the host the second
  // touch was measured against; the pair settles as two coincident walls
  // between the same junctions, one of which the user cannot see or delete.
  // Neither side has a claim to the span, so drop both touches and leave both
  // walls whole — they look joined without being so, which is what they did
  // before this module existed.
  return touches.filter(
    (t) =>
      !touches.some(
        (o) => o.hostId === t.toucher.wallId && o.toucher.wallId === t.hostId,
      ),
  );
}

function applyTouches(
  { walls, items }: WallSplitResult,
  touches: Touch[],
  nextWallId: () => string,
): WallSplitResult {
  const byHost = new Map<string, Touch[]>();
  for (const t of touches) {
    const list = byHost.get(t.hostId);
    if (list) list.push(t);
    else byHost.set(t.hostId, [t]);
  }

  /** Accepted split points per host, ordered along `a` → `b`. */
  const splitsByHost = new Map<string, Point[]>();
  /** Where each touching endpoint is welded to. */
  const weldByEndpoint = new Map<string, Point>();

  for (const [hostId, list] of byHost) {
    const accepted: { offset: number; point: Point }[] = [];
    for (const t of [...list].sort((x, y) => x.offset - y.offset)) {
      const last = accepted[accepted.length - 1];
      // Two endpoints landing all but on top of each other would carve a sliver
      // segment between them, so the second joins the first's junction instead.
      if (last && t.offset - last.offset < MIN_WALL_LENGTH) {
        weldByEndpoint.set(endpointKey(t.toucher), last.point);
        continue;
      }
      accepted.push({ offset: t.offset, point: t.point });
      weldByEndpoint.set(endpointKey(t.toucher), t.point);
    }
    splitsByHost.set(
      hostId,
      accepted.map((s) => s.point),
    );
  }

  // A host's split points were measured against its *pre-weld* geometry, so a
  // host that itself moves this pass would be sliced at stale offsets —
  // leaving overlapping duplicate segments, or ones under `MIN_WALL_LENGTH`.
  // Defer the whole touch (its weld too, since that weld targets a centreline
  // about to move): the next pass re-detects it against settled geometry.
  for (const wall of walls) {
    const moves = ENDS.some((end) => {
      const to = weldByEndpoint.get(`${wall.id}:${end}`);
      return to !== undefined && !pointsEqual(wall[end], to);
    });
    if (!moves || !splitsByHost.delete(wall.id)) continue;
    for (const t of byHost.get(wall.id) ?? []) {
      weldByEndpoint.delete(endpointKey(t.toucher));
    }
  }

  const nextWalls: Wall[] = [];
  /** Host id → the segments that replaced it, so its items can be rebased. */
  const segmentsByHost = new Map<string, Wall[]>();
  const welds: PointWeld[] = [];
  const noteWeld = (from: Point, to: Point) => {
    if (pointsEqual(from, to)) return;
    if (welds.some((w) => pointsEqual(w.from, from))) return;
    welds.push({ from, to });
  };
  for (const wall of walls) {
    // Weld first: a wall can be both a toucher and a host in the same pass, and
    // its segments must start/end at its welded endpoints. Only a weld that
    // leaves the wall put survives the deferral above, so the slice below
    // always runs on settled geometry.
    const weldedA = weldByEndpoint.get(`${wall.id}:a`);
    const weldedB = weldByEndpoint.get(`${wall.id}:b`);
    if (weldedA) noteWeld(wall.a, weldedA);
    if (weldedB) noteWeld(wall.b, weldedB);
    const w: Wall =
      weldedA || weldedB
        ? { ...wall, a: weldedA ?? wall.a, b: weldedB ?? wall.b }
        : wall;

    const splits = splitsByHost.get(w.id);
    if (!splits?.length) {
      nextWalls.push(w);
      continue;
    }
    const segments: Wall[] = [];
    let start = w.a;
    for (const point of splits) {
      // The host keeps its own id for the first segment, so a selected wall
      // stays selected rather than vanishing from the selection.
      const id = segments.length === 0 ? w.id : nextWallId();
      segments.push({ id, a: start, b: point, thickness: w.thickness });
      start = point;
    }
    segments.push({
      id: nextWallId(),
      a: start,
      b: w.b,
      thickness: w.thickness,
    });
    segmentsByHost.set(w.id, segments);
    nextWalls.push(...segments);
  }

  const nextItems: Item[] = [];
  for (const item of items) {
    const segments = segmentsByHost.get(item.wallAttach.wallId);
    if (!segments) {
      nextItems.push(item);
      continue;
    }
    const rebased = rebaseItemToSegments(item, segments);
    if (rebased) nextItems.push(rebased);
  }

  return { walls: nextWalls, items: nextItems, welds };
}

/**
 * Re-attach an opening to whichever segment of its (now split) host holds it,
 * rebasing `offset` to that segment's `a`. An opening straddling a split point
 * goes to the segment holding the larger part of it, keeping its width, and is
 * dropped only if it cannot fit there at all — the same reposition-first,
 * remove-as-a-last-resort rule as `reconcileItemsToWalls`.
 */
function rebaseItemToSegments(item: Item, segments: Wall[]): Item | null {
  const { offset, length } = item.wallAttach;
  const end = offset + length;
  let best: { segment: Wall; start: number; segLength: number } | null = null;
  let bestOverlap = Number.NEGATIVE_INFINITY;
  let start = 0;
  for (const segment of segments) {
    const segLength = getWallLength(segment);
    const overlap = Math.min(end, start + segLength) - Math.max(offset, start);
    // Strict `>` keeps the earlier segment on an exact tie.
    if (overlap > bestOverlap) {
      bestOverlap = overlap;
      best = { segment, start, segLength };
    }
    start += segLength;
  }
  if (!best) return item;
  if (length > best.segLength) return null;
  const rebasedOffset = Math.max(
    0,
    Math.min(offset - best.start, best.segLength - length),
  );
  return {
    ...item,
    wallAttach: {
      ...item.wallAttach,
      wallId: best.segment.id,
      offset: rebasedOffset,
    },
  };
}
