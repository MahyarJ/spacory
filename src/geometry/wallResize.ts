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
import { splitWallsAtTouchingEndpoints } from "./wallSplit";

function touchesHost(walls: Wall[], wall: Wall, point: Point): boolean {
  return walls.some((other) => {
    if (other.id === wall.id) return false;
    const { t, proj } = projectPointToWall(point, other);
    return t > 0 && t < 1 && pointsEqual(point, proj);
  });
}

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
  if (choice !== undefined) return { atA, atB, anchor: choice };
  // An exact T contact counts as joined before its host has been split.
  const joinedA = atA.length > 0 || touchesHost(walls, wall, wall.a);
  const joinedB = atB.length > 0 || touchesHost(walls, wall, wall.b);
  const anchor = joinedA === joinedB ? "center" : joinedA ? "a" : "b";
  return { atA, atB, anchor } as const;
}

/** Move the wall and its immediate junctions using membership from before the resize. */
export function resizeWallInPlan(
  walls: Wall[],
  items: Item[],
  wall: Wall,
  length: number,
  nextWallId: () => string,
  choice?: WallResizeAnchor,
) {
  const context = getWallResizeContext(walls, wall, choice);
  const { anchor } = context;
  const resized = resizeWallToLength(wall, length, anchor);
  const dxA = resized.a.x - wall.a.x;
  const dyA = resized.a.y - wall.a.y;
  const dxB = resized.b.x - wall.b.x;
  const dyB = resized.b.y - wall.b.y;
  if (dxA === 0 && dyA === 0 && dxB === 0 && dyB === 0) return null;

  // Materialize any unsplit host at the original contact so its two legs
  // have endpoints to follow, even if the resize pulls the stem off that line.
  const contacts = (["a", "b"] as const)
    .filter(
      (end) =>
        resized[end] !== wall[end] && touchesHost(walls, wall, wall[end]),
    )
    .map((end) => wall[end]);
  const before = contacts.length
    ? splitWallsAtTouchingEndpoints(walls, items, nextWallId, {
        fixedPoints: contacts,
        onlyTouchesAt: contacts,
      })
    : { walls, items };
  // A partial split still leaves a host without an endpoint to follow.
  if (contacts.some((point) => touchesHost(before.walls, wall, point))) {
    return "blocked-junction" as const;
  }
  const { atA, atB } =
    before.walls === walls
      ? context
      : getWallResizeContext(before.walls, wall, anchor);
  const movedA = translateEndpoints(before.walls, atA, dxA, dyA);
  const movedBoth = translateEndpoints(movedA, atB, dxB, dyB);
  const direction = getWallDirection(wall);
  const shift = dxA * direction.x + dyA * direction.y;
  return {
    resized,
    walls: movedBoth.map((other) => (other.id === wall.id ? resized : other)),
    items:
      shift === 0
        ? before.items
        : before.items.map((item) => {
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
