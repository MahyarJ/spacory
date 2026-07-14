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

describe("live drag item reconciliation", () => {
  function attachedDoor(
    offset: number,
    length: number,
    wallId = "w1",
  ): DoorItem {
    return {
      id: "d1",
      type: "door",
      thickness: 10,
      wallAttach: { wallId, offset, length },
      props: { hingeEdge: "start", swingSide: "outside" },
    };
  }

  it("translateSelectedWallsLive clamps an item on a following wall as it shrinks", () => {
    // w1 selected: (0,0)-(100,0). w2 not selected, joined at (100,0):
    // (100,0)-(100,100), length 100, with a door flush at its far end.
    // Translating w1 down by 50 drags the shared endpoint to (100,50),
    // shrinking w2 to length 50 — the door no longer fits at offset 60.
    const door = attachedDoor(60, 40, "w2");
    useApp
      .getState()
      .loadPlan(
        planWith(
          [wall("w1", 0, 0, 100, 0), wall("w2", 100, 0, 100, 100)],
          [door],
        ),
      );
    useApp.setState({ selectedWalls: new Set(["w1"]) });

    useApp.getState().translateSelectedWallsLive(0, 50);

    const w2 = useApp.getState().plan.walls.find((w) => w.id === "w2");
    expect(w2?.a).toEqual({ x: 100, y: 50 });
    expect(useApp.getState().plan.items[0].wallAttach.offset).toBe(10);
    expect(useApp.getState().plan.items[0].wallAttach.length).toBe(40);
  });

  it("translateSelectedConnectionPointLive clamps an attached item while dragging, without committing history", () => {
    // w1: (0,0)-(100,0), door flush at the far end. Dragging endpoint `b`
    // inward to (70,0) shrinks the wall to 70 live; the door (offset 60,
    // length 40) no longer fits and must clamp to offset 30.
    const door = attachedDoor(60, 40);
    useApp.getState().loadPlan(planWith([wall("w1", 0, 0, 100, 0)], [door]));
    useApp.getState().selectConnectionPoint({ x: 100, y: 0 });

    useApp.getState().translateSelectedConnectionPointLive(-30, 0);

    const w1 = useApp.getState().plan.walls.find((w) => w.id === "w1");
    expect(w1?.b).toEqual({ x: 70, y: 0 });
    expect(useApp.getState().plan.items[0].wallAttach.offset).toBe(30);
    expect(useApp.getState().plan.items[0].wallAttach.length).toBe(40);

    // The live path must not push a new undo-history entry: `loadPlan` starts
    // a fresh (empty) history, so `undo()` here is a no-op if (and only if)
    // the live drag didn't commit — the shrunk/clamped state must survive it.
    useApp.getState().undo();
    expect(useApp.getState().plan.walls.find((w) => w.id === "w1")?.b).toEqual({
      x: 70,
      y: 0,
    });
    expect(useApp.getState().plan.items[0].wallAttach.offset).toBe(30);
  });

  it("translateSelectedConnectionPointLive removes an item that no longer fits, live", () => {
    // Shrinking w1 to 30 leaves no room for a 40-long door — must be removed
    // during the drag itself, not just on drop.
    const door = attachedDoor(0, 40);
    useApp.getState().loadPlan(planWith([wall("w1", 0, 0, 100, 0)], [door]));
    useApp.getState().selectConnectionPoint({ x: 100, y: 0 });

    useApp.getState().translateSelectedConnectionPointLive(-70, 0);

    expect(useApp.getState().plan.items).toHaveLength(0);
  });

  it("reappears a mid-drag-removed item when the same gesture regrows the wall", () => {
    // w1: (0,0)-(100,0), door at offset 0 length 40. Shrinking to 30 (< 40)
    // removes it live; regrowing back past 40 within the same gesture must
    // bring it back rather than leaving it gone until a post-release Undo.
    const door = attachedDoor(0, 40);
    useApp.getState().loadPlan(planWith([wall("w1", 0, 0, 100, 0)], [door]));
    useApp.getState().selectConnectionPoint({ x: 100, y: 0 });
    useApp.getState().beginLiveDrag();

    // Tick 1: drag `b` in to (30,0) — wall length 30, door dropped.
    useApp.getState().translateSelectedConnectionPointLive(-70, 0);
    expect(useApp.getState().plan.items).toHaveLength(0);

    // Tick 2: reverse and drag back out to (100,0) — wall length 100 again.
    useApp.getState().translateSelectedConnectionPointLive(70, 0);
    expect(useApp.getState().plan.items).toHaveLength(1);
    expect(useApp.getState().plan.items[0].wallAttach.offset).toBe(0);
    expect(useApp.getState().plan.items[0].wallAttach.length).toBe(40);
  });

  it("restores a clamped item to its exact pre-drag offset when the gesture regrows the wall", () => {
    // Door at offset 50 length 40 fits a 100-wall ([50,90]). Shrink to 70 →
    // clamps to offset 30; regrow back to 100 within the same gesture must
    // restore the exact pre-drag offset 50, not leave it drifted at 30.
    const door = attachedDoor(50, 40);
    useApp.getState().loadPlan(planWith([wall("w1", 0, 0, 100, 0)], [door]));
    useApp.getState().selectConnectionPoint({ x: 100, y: 0 });
    useApp.getState().beginLiveDrag();

    // Tick 1: shrink to 70 — opening [50,90] no longer fits, clamps to 30.
    useApp.getState().translateSelectedConnectionPointLive(-30, 0);
    expect(useApp.getState().plan.items[0].wallAttach.offset).toBe(30);

    // Tick 2: regrow back to 100 — must snap back to the exact pre-drag offset.
    useApp.getState().translateSelectedConnectionPointLive(30, 0);
    expect(useApp.getState().plan.walls.find((w) => w.id === "w1")?.b).toEqual({
      x: 100,
      y: 0,
    });
    expect(useApp.getState().plan.items[0].wallAttach.offset).toBe(50);
    expect(useApp.getState().plan.items[0].wallAttach.length).toBe(40);
  });

  it("commitPlan clears the pre-drag snapshot so the next gesture starts fresh", () => {
    const door = attachedDoor(50, 40);
    useApp.getState().loadPlan(planWith([wall("w1", 0, 0, 100, 0)], [door]));
    useApp.getState().selectConnectionPoint({ x: 100, y: 0 });
    useApp.getState().beginLiveDrag();
    useApp.getState().translateSelectedConnectionPointLive(-30, 0);
    useApp.getState().commitPlan();

    expect(useApp.getState().liveDragItems).toBeNull();
  });
});

describe("connection-point drag snapping onto unrelated junctions", () => {
  it("does not weld an unrelated junction's walls in when the live drag merely transits over its coordinate", () => {
    // Junction A: w1.b / w2.a at (100, 0). Junction B (unrelated): w3.a at
    // (100, 100), joined to w4. Dragging A up by 100 makes its live position
    // pass exactly through B's coordinate mid-gesture — w3/w4 must stay put.
    useApp
      .getState()
      .loadPlan(
        planWith([
          wall("w1", 0, 0, 100, 0),
          wall("w2", 100, 0, 200, 0),
          wall("w3", 100, 100, 200, 100),
          wall("w4", 100, 100, 100, 200),
        ]),
      );
    useApp.getState().selectConnectionPoint({ x: 100, y: 0 });

    useApp.getState().translateSelectedConnectionPointLive(0, 100);

    const walls = useApp.getState().plan.walls;
    expect(walls.find((w) => w.id === "w1")?.b).toEqual({ x: 100, y: 100 });
    expect(walls.find((w) => w.id === "w2")?.a).toEqual({ x: 100, y: 100 });
    // Junction B's walls are untouched, even though A now sits on B's coordinate.
    expect(walls.find((w) => w.id === "w3")?.a).toEqual({ x: 100, y: 100 });
    expect(walls.find((w) => w.id === "w4")?.a).toEqual({ x: 100, y: 100 });

    // Continuing past B and back off it must not have picked up its walls.
    useApp.getState().translateSelectedConnectionPointLive(0, 50);
    const after = useApp.getState().plan.walls;
    expect(after.find((w) => w.id === "w1")?.b).toEqual({ x: 100, y: 150 });
    expect(after.find((w) => w.id === "w3")?.a).toEqual({ x: 100, y: 100 });
    expect(after.find((w) => w.id === "w4")?.a).toEqual({ x: 100, y: 100 });
  });

  it("still welds on an intentional drop onto another junction's coordinate", () => {
    // Dropping A exactly onto B's coordinate is the existing, intentional
    // merge behavior: it falls out of the shared-coordinate data model at
    // commit time, not a re-derived live membership set.
    useApp
      .getState()
      .loadPlan(
        planWith([
          wall("w1", 0, 0, 100, 0),
          wall("w2", 100, 0, 200, 0),
          wall("w3", 100, 100, 200, 100),
        ]),
      );
    useApp.getState().selectConnectionPoint({ x: 100, y: 0 });

    useApp.getState().translateSelectedConnectionPointLive(0, 100);
    useApp.getState().commitPlan();

    const walls = useApp.getState().plan.walls;
    expect(walls.find((w) => w.id === "w1")?.b).toEqual({ x: 100, y: 100 });
    expect(walls.find((w) => w.id === "w2")?.a).toEqual({ x: 100, y: 100 });
    // w1/w2's dropped endpoint now shares w3's coordinate: connected per the
    // data model (getConnectionPoints/findConnectedEndpoints match by coord).
    expect(walls.find((w) => w.id === "w3")?.a).toEqual({ x: 100, y: 100 });
  });

  it("moves the newly-welded junction's walls together on a nudge right after a merge drop", () => {
    // Regression: dropping A onto B's coordinate welds them, but the
    // selection stays live (no re-click). A subsequent nudge must move the
    // whole merged junction (w1/w2/w3), not just A's grab-time set (w1/w2) —
    // otherwise the nudge silently un-welds the junction just created.
    useApp
      .getState()
      .loadPlan(
        planWith([
          wall("w1", 0, 0, 100, 0),
          wall("w2", 100, 0, 200, 0),
          wall("w3", 100, 100, 200, 100),
        ]),
      );
    useApp.getState().selectConnectionPoint({ x: 100, y: 0 });

    useApp.getState().translateSelectedConnectionPointLive(0, 100);
    useApp.getState().commitPlan();

    useApp.getState().translateSelectedConnectionPoint(10, 0);

    const walls = useApp.getState().plan.walls;
    expect(walls.find((w) => w.id === "w1")?.b).toEqual({ x: 110, y: 100 });
    expect(walls.find((w) => w.id === "w2")?.a).toEqual({ x: 110, y: 100 });
    expect(walls.find((w) => w.id === "w3")?.a).toEqual({ x: 110, y: 100 });
  });

  it("moves the newly-welded junction's walls together on a second nudge across a weld", () => {
    // Regression: same staleness as the merge-drop case above, but reached via
    // two plain nudges (no live drag) — the first nudge welds A onto B's
    // coordinate via commit() directly, and the second nudge must move the
    // whole merged junction, not just A's grab-time set.
    useApp
      .getState()
      .loadPlan(
        planWith([
          wall("w1", 0, 0, 100, 0),
          wall("w2", 100, 0, 200, 0),
          wall("w3", 100, 100, 200, 100),
        ]),
      );
    useApp.getState().selectConnectionPoint({ x: 100, y: 0 });

    useApp.getState().translateSelectedConnectionPoint(0, 100);
    useApp.getState().translateSelectedConnectionPoint(10, 0);

    const walls = useApp.getState().plan.walls;
    expect(walls.find((w) => w.id === "w1")?.b).toEqual({ x: 110, y: 100 });
    expect(walls.find((w) => w.id === "w2")?.a).toEqual({ x: 110, y: 100 });
    expect(walls.find((w) => w.id === "w3")?.a).toEqual({ x: 110, y: 100 });
  });

  it("clears the connection-point selection on undo so a following nudge can't drag the wrong walls", () => {
    // Regression: nudging A onto B's coordinate welds them and re-derives the
    // selection to the merged set, but undo reverts the plan underneath that
    // selection. If the (now stale) selection survived, a following nudge
    // could match it against an unrelated junction at the same coordinate, or
    // silently drag nothing/the wrong walls — so undo drops the selection.
    useApp
      .getState()
      .loadPlan(
        planWith([
          wall("w1", 0, 0, 100, 0),
          wall("w2", 100, 0, 200, 0),
          wall("w3", 100, 100, 200, 100),
        ]),
      );
    useApp.getState().selectConnectionPoint({ x: 100, y: 0 });

    useApp.getState().translateSelectedConnectionPoint(0, 100);
    useApp.getState().undo();

    expect(useApp.getState().selectedConnectionPoint).toBeNull();
    expect(useApp.getState().selectedConnectionPointEndpoints).toEqual([]);

    // A nudge with no selection is a no-op — no wall moves.
    useApp.getState().translateSelectedConnectionPoint(10, 0);
    const walls = useApp.getState().plan.walls;
    expect(walls.find((w) => w.id === "w1")?.b).toEqual({ x: 100, y: 0 });
    expect(walls.find((w) => w.id === "w2")?.a).toEqual({ x: 100, y: 0 });
    expect(walls.find((w) => w.id === "w3")?.a).toEqual({ x: 100, y: 100 });
  });

  it("clears the connection-point selection on loadPlan so a following nudge can't drag the wrong walls", () => {
    // Regression: a held connection-point selection references wall ids by id,
    // not by identity. If a newly loaded plan happens to reuse those same ids
    // (very plausible: ids are read verbatim from the saved JSON), a stale
    // selection would silently translate whichever walls in the *new* plan
    // match those ids instead of being a no-op — so loadPlan drops it.
    useApp
      .getState()
      .loadPlan(
        planWith([wall("w1", 0, 0, 100, 0), wall("w2", 100, 0, 200, 0)]),
      );
    useApp.getState().selectConnectionPoint({ x: 100, y: 0 });

    useApp
      .getState()
      .loadPlan(
        planWith([wall("w1", 0, 0, 100, 100), wall("w2", 100, 100, 200, 100)]),
      );

    expect(useApp.getState().selectedConnectionPoint).toBeNull();
    expect(useApp.getState().selectedConnectionPointEndpoints).toEqual([]);

    // A nudge with no selection is a no-op — no wall moves.
    useApp.getState().translateSelectedConnectionPoint(10, 0);
    const walls = useApp.getState().plan.walls;
    expect(walls.find((w) => w.id === "w1")?.b).toEqual({ x: 100, y: 100 });
    expect(walls.find((w) => w.id === "w2")?.a).toEqual({ x: 100, y: 100 });
  });
});
