import type { Wall } from "@app/schema";
import { describe, expect, it } from "vitest";
import {
  findConnectedEndpoints,
  getConnectionPoints,
  pickWallEndpoint,
  pointsEqual,
  translateEndpoints,
  translateEndpointsAt,
  translateWallEndpoint,
} from "./connectivity";

const wall = (
  id: string,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): Wall => ({
  id,
  a: { x: ax, y: ay },
  b: { x: bx, y: by },
  thickness: 10,
});

describe("pointsEqual", () => {
  it("treats exactly equal coordinates as equal", () => {
    expect(pointsEqual({ x: 1, y: 2 }, { x: 1, y: 2 })).toBe(true);
  });
  it("treats differing coordinates as unequal", () => {
    expect(pointsEqual({ x: 1, y: 2 }, { x: 1, y: 3 })).toBe(false);
  });
  it("absorbs float noise within the epsilon", () => {
    expect(pointsEqual({ x: 1, y: 2 }, { x: 1 + 1e-9, y: 2 })).toBe(true);
  });
});

describe("findConnectedEndpoints", () => {
  it("finds every endpoint at a T-junction", () => {
    const walls = [
      wall("w1", 0, 0, 100, 0),
      wall("w2", 100, 0, 200, 0),
      wall("w3", 100, 0, 100, 100),
    ];
    const refs = findConnectedEndpoints(walls, { x: 100, y: 0 });
    expect(refs).toHaveLength(3);
    expect(refs).toEqual(
      expect.arrayContaining([
        { wallId: "w1", end: "b" },
        { wallId: "w2", end: "a" },
        { wallId: "w3", end: "a" },
      ]),
    );
  });

  it("returns an empty list when no endpoint sits at the point", () => {
    const walls = [wall("w1", 0, 0, 100, 0)];
    expect(findConnectedEndpoints(walls, { x: 50, y: 0 })).toEqual([]);
  });

  it("finds both ends of a zero-length wall", () => {
    const walls = [wall("w1", 5, 5, 5, 5)];
    const refs = findConnectedEndpoints(walls, { x: 5, y: 5 });
    expect(refs).toEqual(
      expect.arrayContaining([
        { wallId: "w1", end: "a" },
        { wallId: "w1", end: "b" },
      ]),
    );
  });
});

describe("getConnectionPoints", () => {
  it("dedups endpoints that share a coordinate", () => {
    const walls = [wall("w1", 0, 0, 100, 0), wall("w2", 100, 0, 100, 100)];
    const points = getConnectionPoints(walls);
    expect(points).toHaveLength(3);
    expect(points).toEqual(
      expect.arrayContaining([
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 100 },
      ]),
    );
  });
});

describe("translateEndpointsAt", () => {
  it("moves every endpoint sharing the coordinate, leaving others untouched", () => {
    const walls = [
      wall("w1", 0, 0, 100, 0),
      wall("w2", 100, 0, 200, 0),
      wall("w3", 100, 0, 100, 100),
    ];
    const moved = translateEndpointsAt(walls, { x: 100, y: 0 }, 5, -5);
    expect(moved[0]).toEqual({
      id: "w1",
      a: { x: 0, y: 0 },
      b: { x: 105, y: -5 },
      thickness: 10,
    });
    expect(moved[1]).toEqual({
      id: "w2",
      a: { x: 105, y: -5 },
      b: { x: 200, y: 0 },
      thickness: 10,
    });
    expect(moved[2]).toEqual({
      id: "w3",
      a: { x: 105, y: -5 },
      b: { x: 100, y: 100 },
      thickness: 10,
    });
  });

  it("keeps unaffected walls at the same object identity", () => {
    const walls = [wall("w1", 0, 0, 100, 0), wall("w2", 500, 500, 600, 500)];
    const moved = translateEndpointsAt(walls, { x: 100, y: 0 }, 1, 1);
    expect(moved[1]).toBe(walls[1]);
  });

  it("is a no-op for a zero delta, returning the same array reference", () => {
    const walls = [wall("w1", 0, 0, 100, 0)];
    expect(translateEndpointsAt(walls, { x: 0, y: 0 }, 0, 0)).toBe(walls);
  });

  it("moves both ends of a zero-length wall together", () => {
    const walls = [wall("w1", 5, 5, 5, 5)];
    const moved = translateEndpointsAt(walls, { x: 5, y: 5 }, 2, 3);
    expect(moved[0]).toEqual({
      id: "w1",
      a: { x: 7, y: 8 },
      b: { x: 7, y: 8 },
      thickness: 10,
    });
  });
});

describe("translateWallEndpoint", () => {
  it("moves only the one wall's chosen endpoint, splitting the junction", () => {
    // w1.b, w2.a and w3.a all sit at (100,0). Detaching w1.b must leave w2/w3.
    const walls = [
      wall("w1", 0, 0, 100, 0),
      wall("w2", 100, 0, 200, 0),
      wall("w3", 100, 0, 100, 100),
    ];
    const moved = translateWallEndpoint(
      walls,
      { wallId: "w1", end: "b" },
      5,
      -5,
    );
    expect(moved[0].b).toEqual({ x: 105, y: -5 });
    expect(moved[1]).toBe(walls[1]); // w2 left at the old junction
    expect(moved[2]).toBe(walls[2]); // w3 left at the old junction
  });

  it("moves endpoint `a` while leaving `b` fixed", () => {
    const walls = [wall("w1", 0, 0, 100, 0)];
    const moved = translateWallEndpoint(
      walls,
      { wallId: "w1", end: "a" },
      10,
      20,
    );
    expect(moved[0]).toEqual({
      id: "w1",
      a: { x: 10, y: 20 },
      b: { x: 100, y: 0 },
      thickness: 10,
    });
  });

  it("is a no-op for a zero delta, returning the same array reference", () => {
    const walls = [wall("w1", 0, 0, 100, 0)];
    expect(translateWallEndpoint(walls, { wallId: "w1", end: "b" }, 0, 0)).toBe(
      walls,
    );
  });
});

describe("pickWallEndpoint", () => {
  const w = wall("w1", 0, 0, 100, 0);

  it("returns the endpoint within tolerance", () => {
    expect(pickWallEndpoint(w, { x: 3, y: 4 }, 10)).toBe("a");
    expect(pickWallEndpoint(w, { x: 98, y: 0 }, 10)).toBe("b");
  });

  it("returns null when neither endpoint is within tolerance", () => {
    expect(pickWallEndpoint(w, { x: 50, y: 0 }, 10)).toBeNull();
  });

  it("prefers the nearer endpoint when both are in range", () => {
    const shortWall = wall("w1", 0, 0, 8, 0);
    expect(pickWallEndpoint(shortWall, { x: 5, y: 0 }, 10)).toBe("b");
    expect(pickWallEndpoint(shortWall, { x: 3, y: 0 }, 10)).toBe("a");
  });

  it("favours `a` on an exact tie", () => {
    expect(pickWallEndpoint(w, { x: 50, y: 0 }, 100)).toBe("a");
  });
});

describe("translateEndpoints", () => {
  it("moves exactly the given refs, leaving other walls untouched", () => {
    const walls = [
      wall("w1", 0, 0, 100, 0),
      wall("w2", 100, 0, 200, 0),
      wall("w3", 500, 500, 600, 500),
    ];
    const refs = findConnectedEndpoints(walls, { x: 100, y: 0 });
    const moved = translateEndpoints(walls, refs, 5, -5);
    expect(moved[0].b).toEqual({ x: 105, y: -5 });
    expect(moved[1].a).toEqual({ x: 105, y: -5 });
    expect(moved[2]).toBe(walls[2]);
  });

  it("does not pull in a wall whose endpoint lands on the target coordinate only after the move", () => {
    // Regression for the drag-snap bug: junction A (w1's `b`) is dragged onto
    // junction B's coordinate (w2's `a`, an unrelated wall). Because the
    // membership set was captured before the move (via findConnectedEndpoints
    // at grab time), w2 must not be swept in even though the two walls now
    // share a coordinate.
    const walls = [wall("w1", 0, 0, 50, 0), wall("w2", 100, 0, 200, 0)];
    const refs = findConnectedEndpoints(walls, { x: 50, y: 0 }); // just w1.b
    const moved = translateEndpoints(walls, refs, 50, 0); // w1.b -> (100, 0)
    expect(moved[0].b).toEqual({ x: 100, y: 0 });
    expect(moved[1]).toBe(walls[1]); // w2 unmoved, still (100,0)-(200,0)
  });

  it("is a no-op for a zero delta, returning the same array reference", () => {
    const walls = [wall("w1", 0, 0, 100, 0)];
    const refs = findConnectedEndpoints(walls, { x: 0, y: 0 });
    expect(translateEndpoints(walls, refs, 0, 0)).toBe(walls);
  });

  it("is a no-op for an empty ref list", () => {
    const walls = [wall("w1", 0, 0, 100, 0)];
    expect(translateEndpoints(walls, [], 5, 5)).toBe(walls);
  });

  it("moves both ends of a zero-length wall together when both are refs", () => {
    const walls = [wall("w1", 5, 5, 5, 5)];
    const refs = findConnectedEndpoints(walls, { x: 5, y: 5 });
    const moved = translateEndpoints(walls, refs, 2, 3);
    expect(moved[0]).toEqual({
      id: "w1",
      a: { x: 7, y: 8 },
      b: { x: 7, y: 8 },
      thickness: 10,
    });
  });
});
