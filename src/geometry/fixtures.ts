import type { Fixture, Point, Wall } from "@app/schema";
import type { Bounds } from "./bounds";
import {
  getPointOnWall,
  getWallAngle,
  getWallDirection,
  getWallLength,
  projectPointToWall,
} from "./wall";

export const FIXTURE_STROKE_WIDTH = 1.5;
export const SINK_WIDTH = 60;
export const SINK_DEPTH = 50;
export const FIXTURE_FACE_REACH = 30;

export type FixtureMount = Pick<Fixture, "wallAttach" | "side">;

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

/** Find the nearest face whose wall can hold the basin's full width. */
export function pickFixtureMount(
  point: Point,
  walls: Wall[],
  width: number,
  reach = FIXTURE_FACE_REACH,
): FixtureMount | null {
  let best: FixtureMount | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const wall of walls) {
    if (getWallLength(wall) < width) continue;
    const { offset, distance } = projectPointToWall(point, wall);
    const faceDistance = distance - wall.thickness / 2;
    if (faceDistance > reach || faceDistance >= bestDistance) continue;
    bestDistance = faceDistance;
    best = {
      wallAttach: fitFixtureSpan(wall, width, offset),
      side: sideOfWall(point, wall) < 0 ? -1 : 1,
    };
  }
  return best;
}

/** Slide against the grab-time attachment unless the pointer reaches another face. */
export function dragFixtureMount(
  point: Point,
  grab: Point,
  fixture: Fixture,
  walls: Wall[],
): FixtureMount | null {
  const { wallId, offset, length } = fixture.wallAttach;
  const mount = pickFixtureMount(point, walls, length);
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

export function getFixtureGeometry(fixture: Fixture, wall: Wall) {
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

export function getFixtureSymbol(fixture: Fixture) {
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
