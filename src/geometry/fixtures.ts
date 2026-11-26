import type { Fixture, Item, Point, Wall } from "@app/schema";
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

/** Slide against the grab-time attachment unless the pointer reaches another face. */
export function dragFixtureMount(
  point: Point,
  grab: Point,
  fixture: Fixture,
  walls: Wall[],
  minTargetSize = 0,
): FixtureMount | null {
  const { wallId, offset, length } = fixture.wallAttach;
  const mount = pickFixtureMount(
    point,
    walls,
    length,
    fixture.depth,
    minTargetSize,
  );
  if (mount && mount.wallAttach.wallId !== wallId) return mount;
  const wall = walls.find((candidate) => candidate.id === wallId);
  if (!wall) return null;

  const { x, y } = getWallDirection(wall);
  const travel = (point.x - grab.x) * x + (point.y - grab.y) * y;
  const side =
    mount && Math.abs(sideOfWall(point, wall)) >= wall.thickness / 2
      ? mount.side
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

/** Slide the selected sinks together, keeping their spacing on a shared wall. */
export function moveFixtureGroup(
  fixtures: Fixture[],
  grabbed: Fixture,
  mount: FixtureMount,
  wallsById: ReadonlyMap<string, Wall>,
): Fixture[] {
  const source = wallsById.get(grabbed.wallAttach.wallId);
  const target = wallsById.get(mount.wallAttach.wallId);
  if (!source || !target) return [];
  const moved = { ...grabbed, ...mount };
  if (fixtures.length === 1) return [moved];

  const centerOffset = ({ offset, length }: Fixture["wallAttach"]) =>
    offset + length / 2;
  const before = getFixtureGeometry(grabbed, source);
  const after = getFixtureGeometry(moved, target);
  const reversed =
    before.along.x * after.along.x + before.along.y * after.along.y < 0;
  return fixtures.map((fixture) => {
    if (fixture.id === grabbed.id) return moved;
    const { wallAttach, side } = fixture;
    const { length } = wallAttach;
    if (wallAttach.wallId === source.id) {
      const spacing =
        centerOffset(wallAttach) - centerOffset(grabbed.wallAttach);
      return {
        ...fixture,
        side: side === grabbed.side ? mount.side : mount.side === 1 ? -1 : 1,
        wallAttach: {
          ...wallAttach,
          wallId: target.id,
          offset: dragOffset(
            centerOffset(mount.wallAttach) +
              (reversed ? -spacing : spacing) -
              length / 2,
            length,
            target,
          ),
        },
      };
    }
    const host = wallsById.get(wallAttach.wallId);
    if (!host) return fixture;
    const along = getWallDirection(host);
    return {
      ...fixture,
      wallAttach: {
        ...wallAttach,
        offset: dragOffset(
          wallAttach.offset +
            (after.back.x - before.back.x) * along.x +
            (after.back.y - before.back.y) * along.y,
          length,
          host,
        ),
      },
    };
  });
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
    items.some((item) => {
      if (item.type !== "door" || item.wallAttach.wallId !== wall.id)
        return false;
      const opening = item.wallAttach;
      return (
        Math.min(offset + length, opening.offset + opening.length) -
          Math.max(offset, opening.offset) >
        CONTACT_EPSILON
      );
    })
  )
    return "door";

  const { back, along, outward } = getFixtureGeometry(fixture, wall);
  for (const polygon of paintedWalls) {
    const local = polygon.map(({ x, y }) => ({
      x: (x - back.x) * along.x + (y - back.y) * along.y,
      y: (x - back.x) * outward.x + (y - back.y) * outward.y,
    }));
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
