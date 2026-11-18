import type { Item, Point, Wall } from "@app/schema";
import {
  findConnectedEndpoints,
  pointsEqual,
  translateEndpoints,
} from "./connectivity";
import {
  getWallDirection,
  projectPointToWall,
  resizeWallToLength,
  type WallResizeAnchor,
} from "./wall";

export function getWallResizeContext(
  walls: Wall[],
  wall: Wall,
  choice?: WallResizeAnchor,
) {
  const atA = findConnectedEndpoints(walls, wall.a).filter(
    (ref) => ref.wallId !== wall.id,
  );
  const atB = findConnectedEndpoints(walls, wall.b).filter(
    (ref) => ref.wallId !== wall.id,
  );
  const joinedA = atA.length > 0;
  const joinedB = atB.length > 0;
  let anchor: WallResizeAnchor =
    joinedA === joinedB ? "center" : joinedA ? "a" : "b";
  // Older or imported plans can contain a T-junction whose host is unsplit.
  // A lone exact contact can serve as the anchor even before the host splits.
  if (!joinedA && !joinedB) {
    const touchesHost = (point: Point) =>
      walls.some((other) => {
        if (other.id === wall.id) return false;
        const { t, proj } = projectPointToWall(point, other);
        return t > 0 && t < 1 && pointsEqual(point, proj);
      });
    const touchesA = touchesHost(wall.a);
    const touchesB = touchesHost(wall.b);
    if (touchesA !== touchesB) anchor = touchesA ? "a" : "b";
  }
  return { atA, atB, anchor: choice ?? anchor };
}

/** Move the wall and its immediate junctions using membership from before the resize. */
export function resizeWallInPlan(
  walls: Wall[],
  items: Item[],
  wall: Wall,
  length: number,
  choice?: WallResizeAnchor,
) {
  const { atA, atB, anchor } = getWallResizeContext(walls, wall, choice);
  const resized = resizeWallToLength(wall, length, anchor);
  const dxA = resized.a.x - wall.a.x;
  const dyA = resized.a.y - wall.a.y;
  const dxB = resized.b.x - wall.b.x;
  const dyB = resized.b.y - wall.b.y;
  if (dxA === 0 && dyA === 0 && dxB === 0 && dyB === 0) return null;

  const movedA = translateEndpoints(walls, atA, dxA, dyA);
  const movedBoth = translateEndpoints(movedA, atB, dxB, dyB);
  const direction = getWallDirection(wall);
  const shift = dxA * direction.x + dyA * direction.y;
  return {
    resized,
    walls: movedBoth.map((other) => (other.id === wall.id ? resized : other)),
    items:
      shift === 0
        ? items
        : items.map((item) => {
            if (item.wallAttach.wallId !== wall.id) return item;
            const { wallAttach } = item;
            return {
              ...item,
              wallAttach: { ...wallAttach, offset: wallAttach.offset - shift },
            };
          }),
    followPoint: (point: Point | null) => {
      if (point && pointsEqual(point, wall.a)) return resized.a;
      if (point && pointsEqual(point, wall.b)) return resized.b;
      return point;
    },
  };
}
