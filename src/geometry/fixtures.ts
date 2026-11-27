import type { Fixture, Item, Point, Wall, WallAttachment } from "@app/schema";
import type { Bounds } from "./bounds";
import {
  getPointOnWall,
  getWallAngle,
  getWallDirection,
  getWallLength,
} from "./wall";

export const FIXTURE_STROKE_WIDTH = 1.5;
export const SINK_WIDTH = 60;
export const SINK_DEPTH = 60;
export const MIN_SINK_TARGET_PX = 32;

// Ignore floating-point noise at edges that are meant to touch.
const CONTACT_EPSILON = 1e-7;

export type FixtureMount = Pick<Fixture, "wallAttach" | "side">;
export type FixtureFootprint = FixtureMount & Pick<Fixture, "depth">;
export type FixtureConflict = "door" | "wall" | "width";
export type FixtureMoveConflict = FixtureConflict | "alignment";

export function fitFixtureSpan(
  wall: Wall,
  width: number,
  centerOffset: number,
) {
  const wallLength = getWallLength(wall);
  const length = Math.min(width, wallLength);
  return {
    wallId: wall.id,
    offset: Math.max(
      0,
      Math.min(centerOffset - length / 2, wallLength - length),
    ),
    length,
  };
}

function sideOfWall(point: Point, wall: Wall): number {
  const { x, y } = getWallDirection(wall);
  return (point.y - wall.a.y) * x - (point.x - wall.a.x) * y;
}

/** Target the entire proposed basin, expanding its hit area in a zoomed-out view. */
export function pickFixtureMount(
  point: Point,
  walls: Wall[],
  width: number,
  depth: number,
  minTargetSize = 0,
): FixtureMount | null {
  let best: FixtureMount | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const wall of walls) {
    if (getWallLength(wall) < width) continue;
    const { x, y } = getWallDirection(wall);
    const offset = (point.x - wall.a.x) * x + (point.y - wall.a.y) * y;
    const signed = sideOfWall(point, wall);
    const faceDistance = Math.abs(signed) - wall.thickness / 2;
    if (faceDistance > Math.max(depth, minTargetSize) + CONTACT_EPSILON)
      continue;
    const wallAttach = fitFixtureSpan(wall, width, offset);
    const outsideSpan = Math.max(
      0,
      wallAttach.offset - offset,
      offset - wallAttach.offset - width,
    );
    if (
      outsideSpan >
      Math.max(0, (minTargetSize - width) / 2) + CONTACT_EPSILON
    )
      continue;
    const distance = Math.hypot(outsideSpan, Math.abs(faceDistance));
    if (distance >= bestDistance) continue;
    bestDistance = distance;
    best = { wallAttach, side: signed < 0 ? -1 : 1 };
  }
  return best;
}

/** Resolve the nearby wall face a drag is targeting. */
export function dragFixtureMount(
  point: Point,
  grab: Point,
  fixture: Fixture,
  walls: Wall[],
  minTargetSize = 0,
): FixtureMount | null {
  const { wallId, offset, length } = fixture.wallAttach;
  const target = pickFixtureMount(
    point,
    walls,
    length,
    fixture.depth,
    minTargetSize,
  );
  if (!target || target.wallAttach.wallId !== wallId) return target;
  const wall = walls.find((candidate) => candidate.id === wallId);
  if (!wall) return null;

  const { x, y } = getWallDirection(wall);
  const travel = (point.x - grab.x) * x + (point.y - grab.y) * y;
  const side =
    Math.abs(sideOfWall(point, wall)) >= wall.thickness / 2
      ? target.side
      : fixture.side;
  return {
    wallAttach: fitFixtureSpan(wall, length, offset + length / 2 + travel),
    side,
  };
}

export function fixtureMountEquals(a: FixtureMount, b: FixtureMount): boolean {
  return (
    a.side === b.side &&
    a.wallAttach.wallId === b.wallAttach.wallId &&
    a.wallAttach.offset === b.wallAttach.offset &&
    a.wallAttach.length === b.wallAttach.length
  );
}

function dragOffset(offset: number, length: number, wall: Wall): number {
  const last = getWallLength(wall) - length;
  if (Math.abs(offset) <= CONTACT_EPSILON) return 0;
  if (last >= 0 && Math.abs(offset - last) <= CONTACT_EPSILON) return last;
  return offset;
}

export function fixturesHaveDifferentWalls(fixtures: readonly Fixture[]) {
  const hostId = fixtures[0]?.wallAttach.wallId;
  return fixtures.some(({ wallAttach }) => wallAttach.wallId !== hostId);
}

export function nearestFixtureCenter(
  fixtures: readonly Fixture[],
  point: Point,
  wallsById: ReadonlyMap<string, Wall>,
) {
  let nearest: { fixture: Fixture; center: Point } | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const fixture of fixtures) {
    const wall = wallsById.get(fixture.wallAttach.wallId);
    if (!wall) continue;
    const { center } = getFixtureGeometry(fixture, wall);
    const distance = Math.hypot(center.x - point.x, center.y - point.y);
    if (distance >= bestDistance) continue;
    nearest = { fixture, center };
    bestDistance = distance;
  }
  return nearest;
}

/** Find a single translation along the group's current wall faces. */
export function slideFixtureGroup(
  fixtures: Fixture[],
  travel: Point,
  wallsById: ReadonlyMap<string, Wall>,
  { clampToWallSpans = false }: { clampToWallSpans?: boolean } = {},
): { moved: Fixture[]; delta: Point; conflict?: FixtureMoveConflict } {
  const direction = fixtures.map((fixture) => {
    const wall = wallsById.get(fixture.wallAttach.wallId);
    return wall && getWallDirection(wall);
  });
  const along = direction[0];
  if (
    !along ||
    direction.some(
      (axis) =>
        !axis ||
        Math.abs(axis.x * along.y - axis.y * along.x) > CONTACT_EPSILON,
    )
  ) {
    return { moved: fixtures, delta: { x: 0, y: 0 }, conflict: "alignment" };
  }
  let distance = travel.x * along.x + travel.y * along.y;
  if (clampToWallSpans) {
    let min = Number.NEGATIVE_INFINITY;
    let max = Number.POSITIVE_INFINITY;
    for (let index = 0; index < fixtures.length; index++) {
      const { wallId, offset, length } = fixtures[index].wallAttach;
      const roomBefore = offset;
      const roomAfter = getWallLength(wallsById.get(wallId)!) - offset - length;
      const axis = direction[index]!;
      const reversed = axis.x * along.x + axis.y * along.y < 0;
      // Intersect the travel allowed by each host, preserving group spacing.
      min = Math.max(min, -(reversed ? roomAfter : roomBefore));
      max = Math.min(max, reversed ? roomBefore : roomAfter);
    }
    distance = min <= max ? Math.max(min, Math.min(distance, max)) : 0;
  }
  const delta = { x: distance * along.x, y: distance * along.y };
  const moved = fixtures.map((fixture) => {
    const { wallId, offset, length } = fixture.wallAttach;
    const wall = wallsById.get(wallId)!;
    const axis = getWallDirection(wall);
    return {
      ...fixture,
      wallAttach: {
        ...fixture.wallAttach,
        offset: dragOffset(
          offset + delta.x * axis.x + delta.y * axis.y,
          length,
          wall,
        ),
      },
    };
  });
  return { moved, delta };
}

/** Move sinks that share one wall, including reattaching them to another wall. */
export function moveFixtureGroup(
  fixtures: Fixture[],
  grabbed: Fixture,
  mount: FixtureMount,
  wallsById: ReadonlyMap<string, Wall>,
): { moved: Fixture[]; movePoint: (point: Point) => Point } | null {
  const source = wallsById.get(grabbed.wallAttach.wallId);
  const target = wallsById.get(mount.wallAttach.wallId);
  if (!source || !target) return null;
  const mounted = { ...grabbed, ...mount };

  const centerOffset = ({ offset, length }: Fixture["wallAttach"]) =>
    offset + length / 2;
  const before = getFixtureGeometry(grabbed, source);
  const after = getFixtureGeometry(mounted, target);
  const direction =
    before.along.x * after.along.x + before.along.y * after.along.y < 0
      ? -1
      : 1;
  const moved = fixtures.map((fixture) => {
    if (fixture.id === grabbed.id) return mounted;
    const { wallAttach, side } = fixture;
    const { length } = wallAttach;
    const spacing = centerOffset(wallAttach) - centerOffset(grabbed.wallAttach);
    return {
      ...fixture,
      side: side === grabbed.side ? mount.side : mount.side === 1 ? -1 : 1,
      wallAttach: {
        ...wallAttach,
        wallId: target.id,
        offset: dragOffset(
          centerOffset(mount.wallAttach) + direction * spacing - length / 2,
          length,
          target,
        ),
      },
    };
  });
  // Labels use the same wall-relative axes and back-edge anchor as the sinks.
  const movePoint = (point: Point) => {
    const x = point.x - before.back.x;
    const y = point.y - before.back.y;
    const along = direction * (x * before.along.x + y * before.along.y);
    const outward = x * before.outward.x + y * before.outward.y;
    return {
      x: after.back.x + along * after.along.x + outward * after.outward.x,
      y: after.back.y + along * after.along.y + outward * after.outward.y,
    };
  };
  return { moved, movePoint };
}

export function getFixtureGeometry(fixture: FixtureFootprint, wall: Wall) {
  const { wallAttach, side, depth } = fixture;
  const width = wallAttach.length;
  const { x, y } = getWallDirection(wall);
  const outward = { x: -y * side, y: x * side };
  const onWall = getPointOnWall(wall, wallAttach.offset + width / 2);
  const back = {
    x: onWall.x + (outward.x * wall.thickness) / 2,
    y: onWall.y + (outward.y * wall.thickness) / 2,
  };
  const center = {
    x: back.x + (outward.x * depth) / 2,
    y: back.y + (outward.y * depth) / 2,
  };
  const angle = (getWallAngle(wall) * 180) / Math.PI + (side === -1 ? 180 : 0);
  const transform = `translate(${back.x} ${back.y}) rotate(${angle})`;
  return { back, center, outward, along: { x, y }, transform };
}

function spansOverlap(a: WallAttachment, b: WallAttachment): boolean {
  return (
    Math.min(a.offset + a.length, b.offset + b.length) -
      Math.max(a.offset, b.offset) >
    CONTACT_EPSILON
  );
}

export function findFixtureDuplicateSpan(
  fixture: Fixture,
  wall: Wall,
  fixtures: readonly Fixture[],
  items: Item[],
  paintedWalls: readonly (readonly Point[])[],
  gap: number,
): WallAttachment | null {
  const { offset, length } = fixture.wallAttach;
  const last = getWallLength(wall) - length;
  if (last < 0) return null;

  const onFace = fixtures.filter(
    (other) =>
      other.wallAttach.wallId === wall.id && other.side === fixture.side,
  );
  const attachAt = (offset: number) => ({ ...fixture.wallAttach, offset });
  const fits = (offset: number) => {
    const wallAttach = attachAt(offset);
    return (
      !onFace.some((other) => spansOverlap(wallAttach, other.wallAttach)) &&
      !getFixtureConflict({ ...fixture, wallAttach }, wall, items, paintedWalls)
    );
  };

  const shift = length + gap;
  const ahead = last - offset;
  const direction = ahead >= shift || ahead >= offset ? 1 : -1;
  const preferred = [direction, -direction]
    .map((sign) => Math.max(0, Math.min(last, offset + sign * shift)))
    .find(fits);
  if (preferred !== undefined) return attachAt(preferred);

  // A copy can start immediately after an obstacle or end immediately before
  // it. Use those boundaries so narrow gaps are found regardless of grid size.
  const offsets = new Set([0, last]);
  for (const obstacle of [
    ...items.filter((item) => item.type === "door"),
    ...onFace,
  ]) {
    const span = obstacle.wallAttach;
    if (span.wallId !== wall.id) continue;
    offsets.add(span.offset - length);
    offsets.add(span.offset + span.length);
  }
  const frame = getFixtureGeometry(fixture, wall);
  const centerOffset = offset + length / 2;
  for (const polygon of paintedWalls) {
    const local = polygonInFixtureFrame(polygon, frame);
    const inDepth = clipPolygon(
      clipPolygon(local, "y", 0, 1),
      "y",
      fixture.depth,
      -1,
    );
    if (Math.abs(doubledArea(inDepth)) <= CONTACT_EPSILON) continue;
    for (const { x } of inDepth) {
      offsets.add(centerOffset + x - length);
      offsets.add(centerOffset + x);
    }
  }

  const fallback = [...offsets]
    .filter((start) => start >= 0 && start <= last)
    .sort(
      (a, b) =>
        Math.abs(a - offset) - Math.abs(b - offset) || direction * (b - a),
    )
    .find(fits);
  return fallback === undefined ? null : attachAt(fallback);
}

function polygonInFixtureFrame(
  polygon: readonly Point[],
  { back, along, outward }: ReturnType<typeof getFixtureGeometry>,
): Point[] {
  return polygon.map(({ x, y }) => ({
    x: (x - back.x) * along.x + (y - back.y) * along.y,
    y: (x - back.x) * outward.x + (y - back.y) * outward.y,
  }));
}

export function getFixtureConflict(
  fixture: FixtureFootprint,
  wall: Wall,
  items: Item[],
  paintedWalls: readonly (readonly Point[])[],
): FixtureConflict | null {
  const { wallAttach, depth } = fixture;
  const { offset, length } = wallAttach;
  const wallLength = getWallLength(wall);
  if (
    length > wallLength ||
    offset < -CONTACT_EPSILON ||
    offset + length > wallLength + CONTACT_EPSILON
  )
    return "width";

  if (
    items.some(
      (item) =>
        item.type === "door" &&
        item.wallAttach.wallId === wall.id &&
        spansOverlap(wallAttach, item.wallAttach),
    )
  )
    return "door";

  const frame = getFixtureGeometry(fixture, wall);
  for (const polygon of paintedWalls) {
    const local = polygonInFixtureFrame(polygon, frame);
    // Clip the painted polygon against the basin in its own coordinate
    // system. An edge or point of contact has zero area after clipping.
    const left = clipPolygon(local, "x", -length / 2, 1);
    const right = clipPolygon(left, "x", length / 2, -1);
    const rear = clipPolygon(right, "y", 0, 1);
    const overlap = clipPolygon(rear, "y", depth, -1);
    if (Math.abs(doubledArea(overlap)) > CONTACT_EPSILON) return "wall";
  }
  return null;
}

function clipPolygon(
  polygon: Point[],
  axis: "x" | "y",
  edge: number,
  sign: 1 | -1,
): Point[] {
  const result: Point[] = [];
  for (let index = 0; index < polygon.length; index++) {
    const to = polygon[index];
    const from = polygon[(index + polygon.length - 1) % polygon.length];
    const start = sign * (from[axis] - edge);
    const end = sign * (to[axis] - edge);
    if (start >= 0 !== end >= 0) {
      const t = start / (start - end);
      result.push({
        x: from.x + t * (to.x - from.x),
        y: from.y + t * (to.y - from.y),
      });
    }
    if (end >= 0) result.push(to);
  }
  return result;
}

function doubledArea(polygon: Point[]): number {
  return polygon.reduce((area, point, index) => {
    const next = polygon[(index + 1) % polygon.length];
    return area + point.x * next.y - point.y * next.x;
  }, 0);
}

export function getFixtureBounds(fixture: Fixture, wall: Wall): Bounds {
  const {
    depth,
    wallAttach: { length },
  } = fixture;
  const { center, along, outward } = getFixtureGeometry(fixture, wall);
  const halfWidth =
    (length / 2) * Math.abs(along.x) + (depth / 2) * Math.abs(outward.x);
  const halfDepth =
    (length / 2) * Math.abs(along.y) + (depth / 2) * Math.abs(outward.y);
  const pad = FIXTURE_STROKE_WIDTH / 2;
  return {
    minX: center.x - halfWidth - pad,
    minY: center.y - halfDepth - pad,
    maxX: center.x + halfWidth + pad,
    maxY: center.y + halfDepth + pad,
  };
}

export function hitFixture(
  point: Point,
  fixture: Fixture,
  wall: Wall,
  pad: number,
): boolean {
  const { back, along, outward } = getFixtureGeometry(fixture, wall);
  const dx = point.x - back.x;
  const dy = point.y - back.y;
  const depth = dx * outward.x + dy * outward.y;
  // Hit tolerance may extend past the sides or front, but never through the wall.
  return (
    Math.abs(dx * along.x + dy * along.y) <=
      fixture.wallAttach.length / 2 + pad &&
    depth >= 0 &&
    depth <= fixture.depth + pad
  );
}

export function getFixtureSymbol(fixture: FixtureFootprint) {
  const {
    wallAttach: { length: width },
    depth,
  } = fixture;
  const rim = { x: -width / 2, y: 0, width, height: depth };
  const basin = {
    x: -width * 0.4,
    y: depth * 0.28,
    width: width * 0.8,
    height: depth * 0.62,
    rx: Math.min(width, depth) * 0.13,
  };
  const drain = { cx: 0, cy: depth * 0.62, r: Math.min(width, depth) * 0.045 };
  const tap = `M 0 ${depth * 0.1} V ${depth * 0.37}`;
  return { rim, basin, drain, tap };
}
