import type { Item, Wall, WindowItem } from "@app/schema";
import { describe, expect, it } from "vitest";
import { findConnectedEndpoints } from "./connectivity";
import { getWallLength } from "./wall";
import { resolveWeldedPoint, splitWallsAtTouchingEndpoints } from "./wallSplit";

const wall = (
  id: string,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  thickness = 10,
): Wall => ({ id, a: { x: ax, y: ay }, b: { x: bx, y: by }, thickness });

const windowOn = (
  id: string,
  wallId: string,
  offset: number,
  length: number,
): WindowItem => ({
  id,
  type: "window",
  wallAttach: { wallId, offset, length },
  thickness: 18,
  props: {},
});

/** Deterministic id source, so assertions can name the generated segments. */
function ids() {
  let n = 0;
  return () => `seg${++n}`;
}

const split = (walls: Wall[], items: Item[] = []) =>
  splitWallsAtTouchingEndpoints(walls, items, ids());

describe("splitWallsAtTouchingEndpoints — detection", () => {
  it("splits the host when an endpoint lands exactly on its centreline", () => {
    // "host" runs along y=0; "t" comes down onto its middle at (50,0).
    const { walls } = split([
      wall("host", 0, 0, 100, 0),
      wall("t", 50, 0, 50, 60),
    ]);

    expect(walls).toEqual([
      wall("host", 0, 0, 50, 0),
      wall("seg1", 50, 0, 100, 0),
      wall("t", 50, 0, 50, 60),
    ]);
  });

  it("splits — and welds the endpoint — when it lands inside the host's body", () => {
    // 3cm off the centreline of a 10cm-thick wall: inside the drawn body.
    const { walls } = split([
      wall("host", 0, 0, 100, 0),
      wall("t", 50, 3, 50, 60),
    ]);

    const t = walls.find((w) => w.id === "t");
    expect(t?.a).toEqual({ x: 50, y: 0 });
    expect(walls.map((w) => w.id)).toEqual(["host", "seg1", "t"]);
  });

  it("leaves both walls alone when the endpoint is outside the host's body", () => {
    // 6cm off the centreline of a 10cm-thick wall: outside it.
    const walls = [wall("host", 0, 0, 100, 0), wall("t", 50, 6, 50, 60)];
    expect(split(walls).walls).toBe(walls);
  });

  it("never tests a wall against itself", () => {
    const walls = [wall("only", 0, 0, 100, 0)];
    expect(split(walls).walls).toBe(walls);
  });

  it("leaves an ordinary corner alone (projection near the host's own end)", () => {
    // "t" starts 0.5cm shy of the host's `b` — a corner, not a mid-span touch.
    const walls = [wall("host", 0, 0, 100, 0), wall("t", 99.5, 0, 99.5, 60)];
    expect(split(walls).walls).toBe(walls);
  });

  it("leaves an exactly-shared corner alone", () => {
    const walls = [wall("w1", 0, 0, 100, 0), wall("w2", 100, 0, 100, 100)];
    expect(split(walls).walls).toBe(walls);
  });
});

describe("splitWallsAtTouchingEndpoints — segments", () => {
  it("gives every segment the host's thickness and keeps the host's id first", () => {
    const { walls } = split([
      wall("host", 0, 0, 100, 0, 24),
      wall("t", 50, 0, 50, 60, 8),
    ]);
    const segments = walls.filter((w) => w.id !== "t");
    expect(segments[0].id).toBe("host");
    expect(segments.map((w) => w.thickness)).toEqual([24, 24]);
  });

  it("splits into as many segments as there are touches, ordered a → b", () => {
    const { walls } = split([
      wall("host", 0, 0, 100, 0),
      // Deliberately out of along-wall order to prove the ordering is by offset.
      wall("t2", 70, 0, 70, 60),
      wall("t1", 30, 0, 30, 60),
    ]);

    expect(walls.filter((w) => w.id.startsWith("t"))).toHaveLength(2);
    expect(walls.filter((w) => !w.id.startsWith("t"))).toEqual([
      wall("host", 0, 0, 30, 0),
      wall("seg1", 30, 0, 70, 0),
      wall("seg2", 70, 0, 100, 0),
    ]);
  });

  it("welds two near-coincident touches into one junction instead of a sliver", () => {
    const { walls } = split([
      wall("host", 0, 0, 100, 0),
      wall("t1", 50, 0, 50, 60),
      wall("t2", 50.4, 0, 20, 60),
    ]);

    // One split point, so two segments — and no sub-MIN_WALL_LENGTH wall.
    expect(walls.filter((w) => !w.id.startsWith("t"))).toEqual([
      wall("host", 0, 0, 50, 0),
      wall("seg1", 50, 0, 100, 0),
    ]);
    expect(walls.find((w) => w.id === "t2")?.a).toEqual({ x: 50, y: 0 });
    for (const w of walls) expect(getWallLength(w)).toBeGreaterThanOrEqual(1);
  });

  it("produces a real three-wall junction the connectivity model can see", () => {
    const { walls } = split([
      wall("host", 0, 0, 100, 0),
      wall("t", 50, 2, 50, 60),
    ]);

    expect(findConnectedEndpoints(walls, { x: 50, y: 0 })).toHaveLength(3);
  });

  it("is idempotent — a second pass over the split plan changes nothing", () => {
    const once = split([wall("host", 0, 0, 100, 0), wall("t", 50, 3, 50, 60)]);
    const twice = split(once.walls, once.items);
    expect(twice.walls).toBe(once.walls);
  });

  it("splits a host that is itself welded onto another wall in the same pass", () => {
    // "t" ends mid-span of "host"; "host" itself ends mid-span of "outer".
    const { walls } = split([
      wall("outer", 0, -50, 0, 50, 10),
      wall("host", 0, 0, 100, 0),
      wall("t", 50, 0, 50, 60),
    ]);

    // outer split at the host's `a`, host split at the touch point.
    expect(findConnectedEndpoints(walls, { x: 0, y: 0 })).toHaveLength(3);
    expect(findConnectedEndpoints(walls, { x: 50, y: 0 })).toHaveLength(3);
    expect(splitWallsAtTouchingEndpoints(walls, [], ids()).walls).toBe(walls);
  });

  it("does not slice a host at offsets measured before its own weld moved it", () => {
    // "x" is both a toucher (its `a` welds 20cm along itself, into the thick
    // "w") and a host (for "t", 5cm from that same end). Splitting it at the
    // pre-weld offset would carve a segment running back over the welded one.
    const { walls } = split([
      wall("w", 20, -50, 20, 50, 40),
      wall("x", 0, 0, 100, 0),
      wall("t", 5, 0, 5, -60),
    ]);

    expect(walls).toEqual([
      wall("w", 20, -50, 20, 0, 40),
      wall("seg1", 20, 0, 20, 50, 40),
      // Welded, and left whole: after the weld "t" is 15cm off its span.
      wall("x", 20, 0, 100, 0),
      wall("t", 5, 0, 5, -60),
    ]);
  });

  it("never leaves a sub-MIN_WALL_LENGTH segment when the host was welded", () => {
    const { walls } = split([
      wall("w", 1.8, -50, 1.8, 50),
      wall("x", 0, 0, 100, 0),
      wall("t", 2.5, 0, 2.5, -60),
    ]);

    // Splitting "x" at (2.5,0) after welding its `a` to (1.8,0) would leave a
    // 0.7cm wall; the touch is dropped once the weld puts it inside the corner.
    for (const w of walls) expect(getWallLength(w)).toBeGreaterThanOrEqual(1);
  });

  it("splits a deferred host on the next pass, against its welded geometry", () => {
    const { walls } = split([
      wall("w", 20, -50, 20, 50, 40),
      wall("x", 0, 0, 100, 0),
      wall("t", 50, 0, 50, -60),
    ]);

    // "x" welds to (20,0) in the first pass and splits at (50,0) in the second,
    // so the touch survives the deferral as a real three-wall junction.
    expect(walls).toEqual([
      wall("w", 20, -50, 20, 0, 40),
      wall("seg1", 20, 0, 20, 50, 40),
      wall("x", 20, 0, 50, 0),
      wall("seg2", 50, 0, 100, 0),
      wall("t", 50, 0, 50, -60),
    ]);
    expect(findConnectedEndpoints(walls, { x: 50, y: 0 })).toHaveLength(3);
  });
});

describe("splitWallsAtTouchingEndpoints — welds", () => {
  it("reports nothing when no endpoint moved", () => {
    // The endpoint was already exactly on the centreline: the host splits, but
    // no coordinate changed, so a caller tracking one has nothing to follow.
    const { welds } = split([
      wall("host", 0, 0, 100, 0),
      wall("t", 50, 0, 50, 60),
    ]);

    expect(welds).toEqual([]);
  });

  it("reports where a welded endpoint moved to", () => {
    const { welds } = split([
      wall("host", 0, 0, 100, 0),
      wall("t", 50, 3, 50, 60),
    ]);

    expect(welds).toEqual([{ from: { x: 50, y: 3 }, to: { x: 50, y: 0 } }]);
    expect(resolveWeldedPoint(welds, { x: 50, y: 3 })).toEqual({
      x: 50,
      y: 0,
    });
  });

  it("leaves an untouched coordinate alone", () => {
    expect(
      resolveWeldedPoint([{ from: { x: 50, y: 3 }, to: { x: 50, y: 0 } }], {
        x: 10,
        y: 10,
      }),
    ).toEqual({ x: 10, y: 10 });
  });

  it("composes a weld across passes to the endpoint's final coordinate", () => {
    // (2,3) sits inside both hosts' bodies, so it is welded twice: onto the
    // horizontal host's centreline in the first pass, then onto the vertical
    // one's in the second. The mapping must start from where it began.
    const { welds, walls } = split([
      wall("h", -50, 0, 50, 0),
      wall("v", 0, -50, 0, 50),
      wall("t", 2, 3, 60, 60),
    ]);

    const landed = walls.find((w) => w.id === "t")?.a;
    expect(landed).toEqual({ x: 0, y: 0 });
    expect(welds).toContainEqual({ from: { x: 2, y: 3 }, to: { x: 0, y: 0 } });
    expect(resolveWeldedPoint(welds, { x: 2, y: 3 })).toEqual({ x: 0, y: 0 });
  });
});

describe("splitWallsAtTouchingEndpoints — openings", () => {
  const hostAndT = (): Wall[] => [
    wall("host", 0, 0, 100, 0),
    wall("t", 60, 0, 60, 40),
  ];

  it("leaves an opening on the first segment with its offset untouched", () => {
    const { items } = split(hostAndT(), [windowOn("win", "host", 10, 20)]);
    expect(items[0].wallAttach).toEqual({
      wallId: "host",
      offset: 10,
      length: 20,
    });
  });

  it("rebases an opening on the second segment onto that segment's `a`", () => {
    const { items } = split(hostAndT(), [windowOn("win", "host", 70, 20)]);
    expect(items[0].wallAttach).toEqual({
      wallId: "seg1",
      offset: 10,
      length: 20,
    });
  });

  it("moves a straddling opening into the segment holding its larger part", () => {
    // Spans 50..80 across the split at 60: 10cm before, 20cm after.
    const { items } = split(hostAndT(), [windowOn("win", "host", 50, 30)]);
    expect(items[0].wallAttach).toEqual({
      wallId: "seg1",
      offset: 0,
      length: 30,
    });
  });

  it("keeps a straddling opening's width when clamping it into its segment", () => {
    // Spans 25..65 across the split at 60: the first segment holds the bulk, and
    // the 40cm opening only fits at offset 20 of that 60cm segment.
    const { items } = split(hostAndT(), [windowOn("win", "host", 25, 40)]);
    expect(items[0].wallAttach).toEqual({
      wallId: "host",
      offset: 20,
      length: 40,
    });
  });

  it("removes an opening only when it cannot fit its segment at all", () => {
    // A 50cm opening in 55..105 belongs to the 40cm second segment; it can't fit.
    const { items } = split(hostAndT(), [windowOn("win", "host", 55, 50)]);
    expect(items).toEqual([]);
  });

  it("leaves openings on walls that were not split untouched", () => {
    const items = [windowOn("win", "t", 5, 20)];
    expect(split(hostAndT(), items).items[0]).toBe(items[0]);
  });
});
