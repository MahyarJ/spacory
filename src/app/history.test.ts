import { describe, expect, it } from "vitest";
import {
  canRedo,
  canUndo,
  commit,
  createHistory,
  type History,
  MAX_STEPS,
  redo,
  undo,
} from "./history";
import { createInitialPlan, type Plan, type Wall } from "./schema";

const wall = (id: string, x: number): Wall => ({
  id,
  a: { x: 0, y: 0 },
  b: { x, y: 0 },
  thickness: 10,
});

const withWalls = (walls: Wall[]): Plan => ({ ...createInitialPlan(), walls });

const A = withWalls([]);
const B = withWalls([wall("w1", 100)]);
const C = withWalls([wall("w1", 100), wall("w2", 200)]);

describe("history commit / undo / redo", () => {
  it("starts empty", () => {
    const h = createHistory(A);
    expect(h.present).toEqual(A);
    expect(canUndo(h)).toBe(false);
    expect(canRedo(h)).toBe(false);
  });

  it("undo reconstructs the exact previous plan from diffs", () => {
    let h = createHistory(A);
    h = commit(h, B);
    h = commit(h, C);
    expect(h.present).toEqual(C);

    h = undo(h);
    expect(h.present).toEqual(B);
    h = undo(h);
    expect(h.present).toEqual(A);
    expect(canUndo(h)).toBe(false);
  });

  it("redo replays forward to the exact plan", () => {
    let h = createHistory(A);
    h = commit(h, B);
    h = commit(h, C);
    h = undo(undo(h)); // back to A
    h = redo(h);
    expect(h.present).toEqual(B);
    h = redo(h);
    expect(h.present).toEqual(C);
    expect(canRedo(h)).toBe(false);
  });

  it("a new commit clears the redo stack", () => {
    let h = createHistory(A);
    h = commit(h, B);
    h = undo(h); // present A, future has B
    expect(canRedo(h)).toBe(true);
    h = commit(h, C); // diverge
    expect(canRedo(h)).toBe(false);
    expect(h.present).toEqual(C);
    h = undo(h);
    expect(h.present).toEqual(A);
  });

  it("does not mutate the present plan when undoing", () => {
    let h = createHistory(A);
    h = commit(h, B);
    const before = structuredClone(h.present);
    undo(h); // discard result
    expect(h.present).toEqual(before);
  });

  it("undo/redo on an empty stack are no-ops", () => {
    const h = createHistory(A);
    expect(undo(h)).toBe(h);
    expect(redo(h)).toBe(h);
  });

  it("caps the past stack at MAX_STEPS", () => {
    let h = createHistory(A);
    for (let i = 0; i < MAX_STEPS + 50; i++) {
      h = commit(h, withWalls([wall("w", i)]));
    }
    expect(h.past.length).toBe(MAX_STEPS);
  });
});

describe("history resilience", () => {
  it("drops the undo stack if a patch is corrupt rather than throwing", () => {
    let h = createHistory(A);
    h = commit(h, B);
    // Corrupt the stored patch with an op that targets a missing path.
    const corrupt: History = {
      ...h,
      past: [[{ op: "remove", path: "/walls/999" }]],
    };
    const result = undo(corrupt);
    expect(result.present).toEqual(h.present); // unchanged
    expect(result.past).toEqual([]); // corrupt stack dropped
  });
});
