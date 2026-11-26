import type { Fixture, Wall } from "@app/schema";
import { describe, expect, it } from "vitest";
import {
  dragFixtureMount,
  getFixtureBounds,
  getFixtureConflict,
  getFixtureGeometry,
  hitFixture,
  moveFixtureGroup,
  pickFixtureMount,
} from "./fixtures";
import { computeWallGeometry, paintedWallPolygons } from "./junction";

const wall: Wall = {
  id: "divider",
  a: { x: 0, y: 0 },
  b: { x: 100, y: 100 },
  thickness: 10,
};
const sink: Fixture = {
  id: "sink",
  type: "sink",
  wallAttach: { wallId: wall.id, offset: 20, length: 60 },
  depth: 40,
  side: 1,
};

describe("wall-backed basin geometry", () => {
  it("derives the orientation and places the back edge on either angled face", () => {
    const positive = getFixtureGeometry(sink, wall);
    const negative = getFixtureGeometry({ ...sink, side: -1 }, wall);
    expect(positive.transform).toMatch(/rotate\(45\)$/);
    expect(negative.transform).toMatch(/rotate\(225\)$/);
    expect(positive.back.x).toBeCloseTo(45 / Math.sqrt(2));
    expect(positive.back.y).toBeCloseTo(55 / Math.sqrt(2));
    expect(negative.back.x).toBeCloseTo(positive.back.y);
    expect(negative.back.y).toBeCloseTo(positive.back.x);

    const deeper = getFixtureGeometry({ ...sink, depth: 80 }, wall);
    expect(deeper.back).toEqual(positive.back);
    expect(deeper.center.x).toBeCloseTo(positive.center.x - 20 / Math.sqrt(2));
    expect(deeper.center.y).toBeCloseTo(positive.center.y + 20 / Math.sqrt(2));
  });

  it("includes the full oriented footprint and tests hits on the correct side", () => {
    const { minX, minY, maxX, maxY } = getFixtureBounds(sink, wall);
    expect(minX).toBeCloseTo(-25 / Math.sqrt(2) - 0.75);
    expect(maxX).toBeCloseTo(75 / Math.sqrt(2) + 0.75);
    expect(minY).toBeCloseTo(25 / Math.sqrt(2) - 0.75);
    expect(maxY).toBeCloseTo(125 / Math.sqrt(2) + 0.75);
    expect(hitFixture({ x: 18, y: 53 }, sink, wall, 0)).toBe(true);
    expect(hitFixture({ x: 50, y: 20 }, sink, wall, 0)).toBe(false);
    expect(hitFixture({ x: 35, y: 33 }, sink, wall, 10)).toBe(false);
    expect(hitFixture({ x: 35, y: 27 }, { ...sink, side: -1 }, wall, 10)).toBe(
      true,
    );
  });

  it("requires a nearby wall that can fit the full width and clamps at the end", () => {
    expect(pickFixtureMount({ x: 50, y: 130 }, [wall], 60, 40)).toBeNull();
    expect(pickFixtureMount({ x: 10, y: 5 }, [wall], 200, 40)).toBeNull();
    expect(pickFixtureMount({ x: 10, y: 5 }, [wall], 60, 40)).toEqual({
      wallAttach: { wallId: "divider", offset: 0, length: 60 },
      side: -1,
    });
  });

  it("expands the target at low zoom while keeping the proposed dimensions", () => {
    const horizontal: Wall = { ...wall, b: { x: 400, y: 0 } };
    const beyondFront = { x: 200, y: 110 };
    expect(pickFixtureMount(beyondFront, [horizontal], 60, 60)).toBeNull();
    const targetAtQuarterScale = 32 / 0.25;
    expect(
      pickFixtureMount(beyondFront, [horizontal], 60, 60, targetAtQuarterScale),
    ).toEqual({
      wallAttach: { wallId: wall.id, offset: 170, length: 60 },
      side: 1,
    });
    expect(
      pickFixtureMount(
        { x: 200, y: 134 },
        [horizontal],
        60,
        60,
        targetAtQuarterScale,
      ),
    ).toBeNull();
  });

  it("allows flush angled wall contact and a corner that touches only the front edge", () => {
    expect(
      getFixtureConflict(
        sink,
        wall,
        [],
        paintedWallPolygons(computeWallGeometry([wall])),
      ),
    ).toBeNull();
    const horizontal: Wall = { ...wall, b: { x: 140, y: 0 } };
    const corner = [
      { x: 25, y: 45 },
      { x: 65, y: 45 },
      { x: 45, y: 55 },
    ];
    expect(getFixtureConflict(sink, horizontal, [], [corner])).toBeNull();
    expect(
      getFixtureConflict({ ...sink, depth: 40.01 }, horizontal, [], [corner]),
    ).toBe("wall");
  });

  it("crosses to the opposite face of the same wall without sliding the basin", () => {
    const grab = { x: 25, y: 48 };
    expect(dragFixtureMount({ x: 36.5, y: 36.5 }, grab, sink, [wall])).toEqual({
      wallAttach: sink.wallAttach,
      side: 1,
    });
    expect(dragFixtureMount({ x: 48, y: 25 }, grab, sink, [wall])).toEqual({
      wallAttach: sink.wallAttach,
      side: -1,
    });
  });

  it("preserves spacing on a reversed destination and slides sinks on separate hosts", () => {
    const source = { ...wall, b: { x: 400, y: 0 } };
    const target = {
      ...wall,
      id: "target",
      a: { x: 500, y: 200 },
      b: { x: 0, y: 200 },
    };
    const other = {
      ...wall,
      id: "other",
      a: { x: 550, y: 0 },
      b: { x: 550, y: 400 },
    };
    const neighbor: Fixture = {
      ...sink,
      id: "neighbor",
      side: -1,
      wallAttach: { ...sink.wallAttach, offset: 140 },
    };
    const separate: Fixture = {
      ...sink,
      id: "separate",
      wallAttach: { ...sink.wallAttach, wallId: other.id, offset: 40 },
    };
    const mount = {
      wallAttach: { wallId: target.id, offset: 210, length: 60 },
      side: -1,
    } as const;
    const walls = new Map(
      [source, target, other].map((host) => [host.id, host]),
    );
    expect(
      moveFixtureGroup([sink, neighbor, separate], sink, mount, walls),
    ).toEqual([
      { ...sink, ...mount },
      {
        ...neighbor,
        side: 1,
        wallAttach: { wallId: target.id, offset: 90, length: 60 },
      },
      { ...separate, wallAttach: { ...separate.wallAttach, offset: 240 } },
    ]);
  });
});
