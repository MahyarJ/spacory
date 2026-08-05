import type { Item, Wall, WindowItem } from "@app/schema";
import { describe, expect, it } from "vitest";
import { getPointOnWall } from "./wall";
import { findVacatedPoints, mergeWallsAtVacatedSeams } from "./wallMerge";

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

/**
 * The state #96's split leaves: "host" runs 0→400 along y=0, cut at (200,0)
 * where "t" ends on it.
 */
const splitHost = () => [
  wall("host", 0, 0, 200, 0),
  wall("seg", 200, 0, 400, 0),
  wall("t", 200, 0, 200, 150),
];

const merge = (before: Wall[], walls: Wall[], items: Item[] = []) =>
  mergeWallsAtVacatedSeams(before, walls, items);

/** Where an opening's midpoint sits in the world, so a rebase can be checked. */
function openingCentre(walls: Wall[], item: Item) {
  const w = walls.find((x) => x.id === item.wallAttach.wallId);
  if (!w) throw new Error(`no wall ${item.wallAttach.wallId}`);
  return getPointOnWall(w, item.wallAttach.offset + item.wallAttach.length / 2);
}

describe("findVacatedPoints", () => {
  it("reports a coordinate an endpoint left", () => {
    const before = splitHost();
    const after = before.filter((w) => w.id !== "t");

    // Both of the deleted wall's ends are vacated; only the seam is a candidate
    // for a merge, which `mergeWallsAtVacatedSeams` decides per coordinate.
    expect(findVacatedPoints(before, after)).toEqual([
      { x: 200, y: 0 },
      { x: 200, y: 150 },
    ]);
  });

  it("reports nothing when an edit only adds an endpoint", () => {
    const before = [wall("w1", 0, 0, 200, 0)];
    const after = [...before, wall("w2", 200, 0, 400, 0)];

    expect(findVacatedPoints(before, after)).toEqual([]);
  });

  it("reports where a whole junction left, but nothing merges there", () => {
    const before = splitHost();
    const after = [
      wall("host", 0, 0, 210, 0),
      wall("seg", 210, 0, 400, 0),
      wall("t", 210, 0, 200, 150),
    ];

    // (200,0) lost every endpoint it had, but the seam is gone with them — the
    // junction simply moved, and the coordinate it moved *to* was filled, not
    // vacated.
    expect(findVacatedPoints(before, after)).toEqual([{ x: 200, y: 0 }]);
    expect(merge(before, after).walls).toBe(after);
  });
});

describe("mergeWallsAtVacatedSeams — the wall that split becomes one again", () => {
  it("merges the host's two segments when the T-wall is deleted", () => {
    const before = splitHost();
    const after = before.filter((w) => w.id !== "t");

    const { walls, mergedPoints } = merge(before, after);

    expect(walls).toEqual([wall("host", 0, 0, 400, 0)]);
    expect(mergedPoints).toEqual([{ x: 200, y: 0 }]);
  });

  it("merges them when the T-wall's endpoint is dragged out of the junction", () => {
    const before = splitHost();
    const after = [
      wall("host", 0, 0, 200, 0),
      wall("seg", 200, 0, 400, 0),
      wall("t", 260, 80, 200, 150),
    ];

    const { walls } = merge(before, after);

    expect(walls).toEqual([
      wall("host", 0, 0, 400, 0),
      wall("t", 260, 80, 200, 150),
    ]);
  });

  it("keeps the earlier wall's id and direction", () => {
    // The seam is on "host"'s `a`, so the merged wall grows backwards out of it
    // — but it still runs in "host"'s direction, from the far end to `host.b`.
    const before = [
      wall("host", 200, 0, 400, 0),
      wall("seg", 0, 0, 200, 0),
      wall("t", 200, 0, 200, 150),
    ];
    const after = before.filter((w) => w.id !== "t");

    expect(merge(before, after).walls).toEqual([wall("host", 0, 0, 400, 0)]);
  });

  it("collapses a run of three segments in one step", () => {
    // Two walls split the same host; both deleted in one action (marquee).
    const before = [
      wall("host", 0, 0, 150, 0),
      wall("segA", 150, 0, 250, 0),
      wall("segB", 250, 0, 400, 0),
      wall("t1", 150, 0, 150, 90),
      wall("t2", 250, 0, 250, 90),
    ];
    const after = before.filter((w) => !w.id.startsWith("t"));

    const { walls, mergedPoints } = merge(before, after);

    expect(walls).toEqual([wall("host", 0, 0, 400, 0)]);
    expect(mergedPoints).toHaveLength(2);
  });

  it("merges a diagonal seam, where the split point is not a round number", () => {
    const before = [
      wall("host", 0, 0, 90, 120),
      wall("seg", 90, 120, 150, 200),
      wall("t", 90, 120, 200, 40),
    ];
    const after = before.filter((w) => w.id !== "t");

    expect(merge(before, after).walls).toEqual([wall("host", 0, 0, 150, 200)]);
  });

  it("is idempotent — re-running on its own result changes nothing", () => {
    const before = splitHost();
    const after = before.filter((w) => w.id !== "t");
    const once = merge(before, after);

    const twice = merge(after, once.walls, once.items);

    expect(twice.walls).toBe(once.walls);
    expect(twice.mergedPoints).toEqual([]);
  });
});

describe("mergeWallsAtVacatedSeams — seams it leaves alone", () => {
  it("leaves a seam that is still a three-wall junction (a partial detach)", () => {
    // Two walls end on the host at the same point; only one is deleted.
    const before = [...splitHost(), wall("u", 200, 0, 200, -150)];
    const after = before.filter((w) => w.id !== "t");

    const { walls, mergedPoints } = merge(before, after);

    expect(walls).toBe(after);
    expect(mergedPoints).toEqual([]);
  });

  it("leaves two walls whose directions differ by a degree", () => {
    const angle = (Math.PI / 180) * 1;
    const before = [
      wall("host", 0, 0, 200, 0),
      wall("seg", 200, 0, 200 + 200 * Math.cos(angle), 200 * Math.sin(angle)),
      wall("t", 200, 0, 200, 150),
    ];
    const after = before.filter((w) => w.id !== "t");

    expect(merge(before, after).walls).toBe(after);
  });

  it("leaves two collinear walls of different thickness", () => {
    const before = [
      wall("host", 0, 0, 200, 0, 10),
      wall("seg", 200, 0, 400, 0, 20),
      wall("t", 200, 0, 200, 150),
    ];
    const after = before.filter((w) => w.id !== "t");

    expect(merge(before, after).walls).toBe(after);
  });

  it("leaves two collinear walls that fold back over each other", () => {
    // Both leave (200,0) heading in the same direction: they overlap the same
    // span rather than continuing through the point.
    const before = [
      wall("host", 0, 0, 200, 0),
      wall("seg", 200, 0, 50, 0),
      wall("t", 200, 0, 200, 150),
    ];
    const after = before.filter((w) => w.id !== "t");

    expect(merge(before, after).walls).toBe(after);
  });

  it("leaves an ordinary corner alone", () => {
    const before = [
      wall("host", 0, 0, 200, 0),
      wall("seg", 200, 0, 200, 200),
      wall("t", 200, 0, 350, 0),
    ];
    const after = before.filter((w) => w.id !== "t");

    expect(merge(before, after).walls).toBe(after);
  });

  it("leaves a collinear run the user just drew — nothing was vacated", () => {
    const before = [wall("w1", 0, 0, 200, 0)];
    const after = [...before, wall("w2", 200, 0, 400, 0)];

    const { walls, items } = merge(before, after, []);

    expect(walls).toBe(after);
    expect(items).toEqual([]);
  });
});

describe("mergeWallsAtVacatedSeams — openings", () => {
  it("keeps an opening on the far segment at the same world position", () => {
    const before = splitHost();
    const after = before.filter((w) => w.id !== "t");
    const win = windowOn("win", "seg", 40, 60);
    const wasAt = openingCentre(before, win);

    const { walls, items } = merge(before, after, [win]);

    expect(items[0].wallAttach.wallId).toBe("host");
    expect(items[0].wallAttach.offset).toBe(240);
    expect(items[0].wallAttach.length).toBe(60);
    expect(openingCentre(walls, items[0])).toEqual(wasAt);
  });

  it("keeps an opening on the kept segment where it was", () => {
    const before = splitHost();
    const after = before.filter((w) => w.id !== "t");
    const win = windowOn("win", "host", 40, 60);
    const wasAt = openingCentre(before, win);

    const { walls, items } = merge(before, after, [win]);

    expect(items[0].wallAttach).toEqual({
      wallId: "host",
      offset: 40,
      length: 60,
    });
    expect(openingCentre(walls, items[0])).toEqual(wasAt);
  });

  it("rebases an opening on a segment that merges in reversed", () => {
    // "seg" runs *towards* the seam, so its offsets are measured from the far
    // end — the opposite way round from the merged wall's.
    const before = [
      wall("host", 0, 0, 200, 0),
      wall("seg", 400, 0, 200, 0),
      wall("t", 200, 0, 200, 150),
    ];
    const after = before.filter((w) => w.id !== "t");
    const win = windowOn("win", "seg", 40, 60);
    const wasAt = openingCentre(before, win);

    const { walls, items } = merge(before, after, [win]);

    expect(walls).toEqual([wall("host", 0, 0, 400, 0)]);
    // 40cm from (400,0) — i.e. 100cm along the merged wall's 0→400 direction.
    expect(items[0].wallAttach.offset).toBe(300);
    expect(openingCentre(walls, items[0])).toEqual(wasAt);
  });

  it("keeps every opening on a run that collapses in one step", () => {
    const before = [
      wall("host", 0, 0, 150, 0),
      wall("segA", 150, 0, 250, 0),
      wall("segB", 250, 0, 400, 0),
      wall("t1", 150, 0, 150, 90),
      wall("t2", 250, 0, 250, 90),
    ];
    const after = before.filter((w) => !w.id.startsWith("t"));
    const wins = [
      windowOn("w-host", "host", 20, 40),
      windowOn("w-a", "segA", 20, 40),
      windowOn("w-b", "segB", 20, 40),
    ];
    const wasAt = wins.map((w) => openingCentre(before, w));

    const { walls, items } = merge(before, after, wins);

    expect(items).toHaveLength(3);
    expect(items.map((i) => openingCentre(walls, i))).toEqual(wasAt);
    expect(items.every((i) => i.wallAttach.wallId === "host")).toBe(true);
  });
});
