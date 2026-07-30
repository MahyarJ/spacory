import type { DoorItem, Plan, Wall } from "@app/schema";
import { useApp } from "@app/store";
import { MIN_OPENING_WIDTH } from "@geometry/opening";
import { getWallLength, MIN_WALL_LENGTH } from "@geometry/wall";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  commitDraftOnOutsidePointerDown,
  type DraftFieldNode,
  isCommittingPointerDown,
  type PointerDownLike,
  type PointerDownSource,
  parseDraft,
  type TargetNode,
} from "./draftField";

describe("parseDraft", () => {
  it("accepts a numeric draft at or above the minimum", () => {
    expect(parseDraft("320", MIN_WALL_LENGTH)).toBe(320);
    expect(parseDraft(" 42.5 ", MIN_WALL_LENGTH)).toBe(42.5);
    expect(parseDraft("5", MIN_OPENING_WIDTH)).toBe(MIN_OPENING_WIDTH);
  });

  it("rejects the drafts the fields already reject", () => {
    expect(parseDraft("", MIN_WALL_LENGTH)).toBeNull();
    expect(parseDraft("   ", MIN_WALL_LENGTH)).toBeNull();
    expect(parseDraft("abc", MIN_WALL_LENGTH)).toBeNull();
    expect(parseDraft("0", MIN_WALL_LENGTH)).toBeNull();
    expect(parseDraft("-30", MIN_WALL_LENGTH)).toBeNull();
    expect(parseDraft("4", MIN_OPENING_WIDTH)).toBeNull();
  });
});

/**
 * A DOM node stand-in. Only its identity matters — the module never does more
 * with one than compare it via `contains` — but it carries the `nodeType` the
 * real thing has, so it satisfies `TargetNode` rather than sidestepping it.
 */
function fakeNode(name: string): TargetNode & { name: string } {
  return { nodeType: 1 /* ELEMENT_NODE */, name };
}

/**
 * A field element stand-in: `inside` are the nodes it contains (its input,
 * label, unit suffix), everything else — the canvas — is outside.
 */
function fakeField(...inside: TargetNode[]): DraftFieldNode {
  return { contains: (node) => inside.some((n) => n === node) };
}

describe("isCommittingPointerDown", () => {
  const input = fakeNode("input");
  const canvas = fakeNode("canvas");
  const field = fakeField(input);

  it("commits when a focused field is clicked away from", () => {
    expect(isCommittingPointerDown(field, canvas, input)).toBe(true);
  });

  it("does not commit when the press lands inside the field", () => {
    expect(isCommittingPointerDown(field, input, input)).toBe(false);
  });

  it("does not commit when the field is not focused — blur already did", () => {
    expect(isCommittingPointerDown(field, canvas, canvas)).toBe(false);
    expect(isCommittingPointerDown(field, canvas, null)).toBe(false);
  });

  it("does not commit before the field's ref is attached", () => {
    expect(isCommittingPointerDown(null, canvas, input)).toBe(false);
  });
});

/** A `document` stand-in that lets a test press somewhere in the app. */
function fakePointerDownSource() {
  const listeners = new Set<(event: PointerDownLike) => void>();
  const source: PointerDownSource = {
    addEventListener: (_type, listener) => {
      listeners.add(listener);
    },
    removeEventListener: (_type, listener) => {
      listeners.delete(listener);
    },
  };
  return {
    source,
    listenerCount: () => listeners.size,
    pressOn: (target: TargetNode | null) => {
      for (const listener of [...listeners]) listener({ target });
    },
  };
}

describe("commitDraftOnOutsidePointerDown", () => {
  it("commits on a press outside the focused field, and stops on cleanup", () => {
    const input = fakeNode("input");
    const canvas = fakeNode("canvas");
    const commit = vi.fn();
    const dom = fakePointerDownSource();

    const cleanup = commitDraftOnOutsidePointerDown({
      source: dom.source,
      getField: () => fakeField(input),
      getActiveElement: () => input,
      commit,
    });

    dom.pressOn(input);
    expect(commit).not.toHaveBeenCalled();

    dom.pressOn(canvas);
    expect(commit).toHaveBeenCalledTimes(1);

    cleanup();
    expect(dom.listenerCount()).toBe(0);
    dom.pressOn(canvas);
    expect(commit).toHaveBeenCalledTimes(1);
  });
});

// --- The click-away commit end to end -------------------------------------
//
// Wires the real listener to the real store action the way `WallOptions.tsx`
// does, so these fail if the click-away path is removed: they assert the
// user-visible outcome (the wall/opening actually resizes, once).

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

beforeEach(() => {
  vi.stubGlobal("localStorage", makeStorage());
});

function wall(id: string, bx: number): Wall {
  return { id, a: { x: 0, y: 0 }, b: { x: bx, y: 0 }, thickness: 10 };
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

function door(wallId: string, length: number): DoorItem {
  return {
    id: "d1",
    type: "door",
    thickness: 10,
    wallAttach: { wallId, offset: 10, length },
    props: { hingeEdge: "start", swingSide: "outside" },
  };
}

/**
 * Mount a field the way `WallOptions.tsx` does: its draft commits through
 * `parseDraft` into the given store action, on a press outside the field.
 */
function mountField(
  dom: ReturnType<typeof fakePointerDownSource>,
  input: TargetNode,
  draft: () => string,
  min: number,
  apply: (value: number) => void,
) {
  return commitDraftOnOutsidePointerDown({
    source: dom.source,
    getField: () => fakeField(input),
    getActiveElement: () => input,
    commit: () => {
      const parsed = parseDraft(draft(), min);
      if (parsed !== null) apply(parsed);
    },
  });
}

describe("click-away commits the typed value", () => {
  const canvas = fakeNode("canvas");

  it("applies a typed wall length when the canvas is pressed", () => {
    useApp.getState().loadPlan(planWith([wall("w1", 250)]));
    useApp.setState({ selectedWalls: new Set(["w1"]) });
    const input = fakeNode("wall-length-input");
    const dom = fakePointerDownSource();
    mountField(
      dom,
      input,
      () => "320",
      MIN_WALL_LENGTH,
      (v) => useApp.getState().setSelectedWallLength(v),
    );

    dom.pressOn(canvas);

    const resized = useApp.getState().plan.walls[0];
    expect(getWallLength(resized)).toBe(320);
  });

  it("applies a typed opening width when the canvas is pressed", () => {
    useApp.getState().loadPlan(planWith([wall("w1", 250)], [door("w1", 80)]));
    useApp.setState({ selectedItems: new Set(["d1"]) });
    const input = fakeNode("opening-width-input");
    const dom = fakePointerDownSource();
    mountField(
      dom,
      input,
      () => "100",
      MIN_OPENING_WIDTH,
      (v) => useApp.getState().setSelectedOpeningWidth(v),
    );

    dom.pressOn(canvas);

    expect(useApp.getState().plan.items[0].wallAttach.length).toBe(100);
  });

  it("produces exactly one undo entry, restoring the previous length", () => {
    useApp.getState().loadPlan(planWith([wall("w1", 250)]));
    useApp.setState({ selectedWalls: new Set(["w1"]) });
    const input = fakeNode("wall-length-input");
    const dom = fakePointerDownSource();
    mountField(
      dom,
      input,
      () => "320",
      MIN_WALL_LENGTH,
      (v) => useApp.getState().setSelectedWallLength(v),
    );

    dom.pressOn(canvas);
    // A press that clears the selection also blurs the input in the browser, so
    // the same draft may commit twice — the second must be a no-op, not a
    // second (or empty) undo entry.
    dom.pressOn(canvas);
    expect(getWallLength(useApp.getState().plan.walls[0])).toBe(320);

    useApp.getState().undo();
    expect(getWallLength(useApp.getState().plan.walls[0])).toBe(250);
    // `loadPlan` started a fresh timeline, so if a stray entry had been pushed
    // this second undo would step back to 320.
    useApp.getState().undo();
    expect(getWallLength(useApp.getState().plan.walls[0])).toBe(250);
  });

  it("leaves the plan untouched when the draft is invalid", () => {
    useApp.getState().loadPlan(planWith([wall("w1", 250)]));
    useApp.setState({ selectedWalls: new Set(["w1"]) });
    const input = fakeNode("wall-length-input");
    const dom = fakePointerDownSource();
    mountField(
      dom,
      input,
      () => "abc",
      MIN_WALL_LENGTH,
      (v) => useApp.getState().setSelectedWallLength(v),
    );

    dom.pressOn(canvas);

    expect(getWallLength(useApp.getState().plan.walls[0])).toBe(250);
  });
});
