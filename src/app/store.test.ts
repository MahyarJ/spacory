import type { DoorItem, Plan, Wall } from "@app/schema";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useApp } from "./store";

/** Minimal in-memory localStorage stand-in for the node test environment. */
function makeStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (k) => map.get(k) ?? null,
    key: (i) => [...map.keys()][i] ?? null,
    removeItem: (k) => map.delete(k),
    setItem: (k, v) => {
      map.set(k, v);
    },
  };
}

function wall(
  id: string,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): Wall {
  return { id, a: { x: ax, y: ay }, b: { x: bx, y: by }, thickness: 10 };
}

function planWith(walls: Wall[], items: Plan["items"] = []): Plan {
  return {
    version: "1.2.0",
    meta: {
      name: "test",
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString(),
      units: "cm",
      gridSize: 20,
    },
    walls,
    items,
  };
}

beforeEach(() => {
  vi.stubGlobal("localStorage", makeStorage());
});

function loadWithSelection(walls: Wall[], selected: string[]) {
  useApp.getState().loadPlan(planWith(walls));
  useApp.setState({ selectedWalls: new Set(selected) });
}

describe("translateSelectedWalls", () => {
  it("moves a connected non-selected wall's shared endpoint along", () => {
    // w1: (0,0)-(100,0), w2 joined at (100,0): (100,0)-(100,100)
    loadWithSelection(
      [wall("w1", 0, 0, 100, 0), wall("w2", 100, 0, 100, 100)],
      ["w1"],
    );

    useApp.getState().translateSelectedWalls(10, 5);

    const walls = useApp.getState().plan.walls;
    const w1 = walls.find((w) => w.id === "w1");
    const w2 = walls.find((w) => w.id === "w2");
    expect(w1).toEqual(wall("w1", 10, 5, 110, 5));
    // w2's endpoint that was joined at (100,0) follows to (110,5); its other
    // endpoint is untouched.
    expect(w2?.a).toEqual({ x: 110, y: 5 });
    expect(w2?.b).toEqual({ x: 100, y: 100 });
  });

  it("does not cascade beyond the immediate shared endpoint", () => {
    // w1-w2 joined at (100,0); w2-w3 joined at w2's other endpoint (100,100).
    loadWithSelection(
      [
        wall("w1", 0, 0, 100, 0),
        wall("w2", 100, 0, 100, 100),
        wall("w3", 100, 100, 200, 100),
      ],
      ["w1"],
    );

    useApp.getState().translateSelectedWalls(10, 5);

    const w3 = useApp.getState().plan.walls.find((w) => w.id === "w3");
    // w3 is only joined to w2's far endpoint, not to the moved endpoint — untouched.
    expect(w3).toEqual(wall("w3", 100, 100, 200, 100));
  });

  it("does not collapse a wall translated by exactly its own length", () => {
    // Translating w1 by (100, 0) moves both its endpoints; the first-moved
    // endpoint must not be re-matched and moved again on the second pass.
    loadWithSelection([wall("w1", 0, 0, 100, 0)], ["w1"]);

    useApp.getState().translateSelectedWalls(100, 0);

    const w1 = useApp.getState().plan.walls.find((w) => w.id === "w1");
    expect(w1).toEqual(wall("w1", 100, 0, 200, 0));
  });

  it("leaves an unconnected wall untouched", () => {
    loadWithSelection(
      [wall("w1", 0, 0, 100, 0), wall("w2", 500, 500, 600, 500)],
      ["w1"],
    );

    useApp.getState().translateSelectedWalls(10, 5);

    expect(useApp.getState().plan.walls.find((w) => w.id === "w2")).toEqual(
      wall("w2", 500, 500, 600, 500),
    );
  });
});

describe("setSelectedWallLength", () => {
  it("moves the connected wall joined at the resized endpoint", () => {
    // w1 endpoint b at (100,0) is joined to w2's endpoint a.
    loadWithSelection(
      [wall("w1", 0, 0, 100, 0), wall("w2", 100, 0, 100, 100)],
      ["w1"],
    );

    useApp.getState().setSelectedWallLength(200);

    const walls = useApp.getState().plan.walls;
    const w1 = walls.find((w) => w.id === "w1");
    const w2 = walls.find((w) => w.id === "w2");
    expect(w1?.a).toEqual({ x: 0, y: 0 });
    expect(w1?.b).toEqual({ x: 200, y: 0 });
    expect(w2?.a).toEqual({ x: 200, y: 0 });
    expect(w2?.b).toEqual({ x: 100, y: 100 });
  });

  it("does not move the fixed `a` endpoint's connections", () => {
    // w0 is joined to w1's `a` endpoint (0,0), which never moves on a resize.
    loadWithSelection(
      [wall("w0", -100, 0, 0, 0), wall("w1", 0, 0, 100, 0)],
      ["w1"],
    );

    useApp.getState().setSelectedWallLength(200);

    expect(useApp.getState().plan.walls.find((w) => w.id === "w0")).toEqual(
      wall("w0", -100, 0, 0, 0),
    );
  });

  it("preserves an attached item's offset along the resized wall", () => {
    const door: DoorItem = {
      id: "d1",
      type: "door",
      thickness: 10,
      wallAttach: { wallId: "w1", offset: 40, length: 80 },
      props: { hingeEdge: "start", swingSide: "outside" },
    };
    useApp.getState().loadPlan(planWith([wall("w1", 0, 0, 100, 0)], [door]));
    useApp.setState({ selectedWalls: new Set(["w1"]) });

    useApp.getState().setSelectedWallLength(200);

    expect(useApp.getState().plan.items[0].wallAttach.offset).toBe(40);
  });
});
