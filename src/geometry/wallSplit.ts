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
 * Cap on detect→apply rounds. One round normally settles the whole plan (a
 * split only ever creates endpoints at coordinates that are already shared, so
 * it can't produce new mid-span touches); the loop exists for the rare endpoint
 * that lands inside *two* walls' bodies at once, which can only be welded onto
 * one of them per round.
 */
const MAX_PASSES = 8;

const endpointKey = (ref: WallEndpointRef) => `${ref.wallId}:${ref.end}`;

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
  for (let pass = 0; pass < MAX_PASSES; pass++) {
    const touches = detectTouches(result.walls);
    if (touches.length === 0) break;
    const applied = applyTouches(result, touches, nextWallId);
    result = { ...applied, welds: composeWelds(result.welds, applied.welds) };
  }
  return result;
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
    for (const end of ENDS) {
      let best: Touch | null = null;
      for (const host of walls) {
        if (host.id === w.id) continue;
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
      if (best) touches.push(best);
    }
  }
  return touches;
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
    // its segments must start/end at its welded endpoints.
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
