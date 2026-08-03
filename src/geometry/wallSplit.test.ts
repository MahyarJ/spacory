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

  it("leaves a wall crossing a thick host alone rather than collapsing it", () => {
    // A 30cm stub drawn across a 40cm-thick wall: both its ends sit inside the
    // host's body and project to the same point, so welding both would leave a
    // zero-length wall. It's an overlap, not a T.
    const walls = [
      wall("host", 0, 0, 300, 0, 40),
      wall("stub", 150, -15, 150, 15),
    ];
    expect(split(walls).walls).toBe(walls);
  });

  it("leaves a wall lying along a host's body alone", () => {
    // Drawn 4cm off the centreline of a 10cm-thick wall: welding both ends
    // would make the host's middle segment a duplicate of this very wall.
    const walls = [
      wall("host", 0, 0, 300, 0),
      wall("alongside", 50, 4, 200, 4),
    ];
    expect(split(walls).walls).toBe(walls);
  });

  it("leaves a wall that runs from a shared corner back onto the host alone", () => {
    // "spur" starts at the host's own `a` and ends 3cm off its centreline
    // further along. Welding that end would leave "spur" spanning (0,0)→(150,0)
    // — a duplicate of the host segment between the very same junctions.
    const walls = [wall("host", 0, 0, 300, 0), wall("spur", 0, 0, 150, 3)];
    expect(split(walls).walls).toBe(walls);
  });

  it("still splits a third wall a toucher shares no junction with", () => {
    // The rule is about the pair that already meets: "t" shares a corner with
    // "corner" but ends mid-span of "host", which is an ordinary T.
    const { walls } = split([
      wall("host", 0, 0, 100, 0),
      wall("corner", 0, 80, 50, 80),
      wall("t", 50, 80, 50, 3),
    ]);

    expect(walls.find((w) => w.id === "t")).toEqual(wall("t", 50, 80, 50, 0));
    expect(findConnectedEndpoints(walls, { x: 50, y: 0 })).toHaveLength(3);
  });

  it("leaves both walls whole when each one ends inside the other's body", () => {
    // Two walls 3cm apart, each overlapping the other's last 80cm: "y"'s `a`
    // sits in "x"'s body and "x"'s `b` sits in "y"'s. A mutual touch is one
    // overlap seen from both sides, not a pair of Ts — welding either drags the
    // centreline the other was measured against.
    const walls = [wall("x", 0, 0, 100, 0), wall("y", 20, 3, 120, 3)];
    expect(split(walls).walls).toBe(walls);
  });

  it("leaves both whole regardless of which of the pair comes first", () => {
    // Which wall of a mutual touch got mangled used to be array order.
    const walls = [wall("y", 20, 3, 120, 3), wall("x", 0, 0, 100, 0)];
    expect(split(walls).walls).toBe(walls);
  });

  it("never produces two walls spanning the same pair of junctions", () => {
    // The reported plan: "w3" ends inside "w2"'s 40cm body, which splits it —
    // and that weld used to leave the pair touching a second time, welding
    // again into two coincident walls between the same junctions.
    const { walls } = split([
      wall("w2", 142.4, 59.9, 127.1, 191.6, 40),
      wall("w3", 121.1, 285.9, 119.3, 164.5),
    ]);

    const spans = walls.map((w) =>
      [w.a.x, w.a.y, w.b.x, w.b.y]
        .map((n) => n.toFixed(3))
        .sort()
        .join(),
    );
    expect(new Set(spans).size).toBe(spans.length);
    // What's left is the one genuine T the first touch made.
    expect(walls).toHaveLength(3);
  });

  it("leaves a thick-wall tangle alone rather than grinding it into slivers", () => {
    // "c" ends inside "a"'s 40cm body, so it wants to weld — but at that
    // thickness the detection band is 20cm, wide enough that the a/b junction
    // falls inside *c*'s body and gets welded too, dragging walls the user did
    // join in order to join them to one they didn't. Each pass created more
    // touches than it resolved; the run used to be applied anyway, leaving 27
    // walls. A run that can't settle is discarded whole.
    const walls = [
      wall("a1", 140, 120, 200, 120, 40),
      wall("a2", 200, 120, 260, 120, 40),
      wall("b", 200, 120, 160, 260, 40),
      wall("c", 220, 40, 180, 100, 40),
    ];
    expect(split(walls).walls).toBe(walls);
  });

  it("does not shorten a wall below the minimum to reach two hosts", () => {
    // "t" spans two centrelines 0.5cm apart, so welding both ends leaves it
    // 0.5cm long. The invariant is unconditional, so the split stands down.
    const walls = [
      wall("h1", 2, -50, 2, 50),
      wall("h2", 2.5, -50, 2.5, 50),
      wall("t", 0, 0, 4, 0),
    ];
    expect(split(walls).walls).toBe(walls);
  });

  it("drags every wall end sharing the welded coordinate onto the split point", () => {
    // "in" lies along "host"'s 40cm body, so it is left alone (both ends inside
    // one host). "t" starts on the same coordinate as "in" and does weld onto
    // the host. A weld moves the *coordinate*, not just the end that was
    // detected: welding only "t" used to leave "in" behind at (15,150), quietly
    // undoing the corner the two walls were drawn sharing.
    const { walls } = split([
      wall("host", 0, 0, 0, 300, 40),
      wall("in", 15, 150, 15, 60),
      wall("t", 15, 150, 150, 150),
    ]);

    expect(walls.find((w) => w.id === "t")?.a).toEqual({ x: 0, y: 150 });
    expect(walls.find((w) => w.id === "in")?.a).toEqual({ x: 0, y: 150 });
    // Host split in two, plus both walls: a four-member junction, and the pair
    // the user drew together is still together.
    expect(findConnectedEndpoints(walls, { x: 0, y: 150 })).toHaveLength(4);
  });

  it("keeps a drawn corner intact when a later wall welds onto a third", () => {
    // The reported shape: "w1" is drawn from "w0"'s corner and "w2" from "w1"'s
    // far end. "w2"'s start sits 20cm off "w0"'s centreline — inside its 40cm
    // body — so it wants to weld onto (280,280), and "w1" ends on that same
    // coordinate. Welding "w2" alone left "w1" behind with a free end: joining
    // one wall took another apart. Dragging "w1" along instead would leave it
    // spanning the same pair of points as "w0"'s lower segment, so the run is
    // declined whole and both walls stay as drawn.
    const walls = [
      wall("w0", 280, 40, 280, 300, 40),
      wall("w1", 280, 40, 300, 280, 20),
      wall("w2", 300, 280, 60, 120, 7),
    ];

    expect(split(walls).walls).toBe(walls);
    expect(findConnectedEndpoints(walls, { x: 300, y: 280 })).toHaveLength(2);
  });

  it("still splits both hosts when each end lands on a different one", () => {
    // The rule is "both ends on the *same* host"; a wall spanning between two
    // walls is an ordinary pair of T-junctions.
    const { walls } = split([
      wall("h1", 0, 0, 100, 0),
      wall("h2", 0, 80, 100, 80),
      wall("t", 50, 3, 50, 77),
    ]);

    expect(walls.find((w) => w.id === "t")).toEqual(wall("t", 50, 0, 50, 80));
    expect(findConnectedEndpoints(walls, { x: 50, y: 0 })).toHaveLength(3);
    expect(findConnectedEndpoints(walls, { x: 50, y: 80 })).toHaveLength(3);
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
