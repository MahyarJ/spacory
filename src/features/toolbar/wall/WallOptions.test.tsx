// @vitest-environment jsdom
//
// Covers the one link `draftField.test.ts` can't reach: that `WallOptions`
// actually *wires* the click-away commit up. These mount the real component and
// press the real document, so deleting `ref={fieldRef}` or the
// `useCommitOnClickAway(commit)` call fails them.
import {
  createInitialPlan,
  type DoorItem,
  type Plan,
  type Wall,
} from "@app/schema";
import { useApp } from "@app/store";
import { getWallLength } from "@geometry/wall";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WallOptions } from "./WallOptions";

const wall = (
  ax: number,
  ay: number,
  bx: number,
  by: number,
  id: string,
): Wall => ({ id, a: { x: ax, y: ay }, b: { x: bx, y: by }, thickness: 10 });

const door = (wallId: string, length: number): DoorItem => ({
  id: "d1",
  type: "door",
  thickness: 10,
  wallAttach: { wallId, offset: 40, length },
  props: { hingeEdge: "start", swingSide: "outside" },
});

/** Two walls sharing a corner — a real plan, not a lone wall. `w1` is 250 cm. */
const cornerPlan = (items: Plan["items"] = []): Plan => ({
  ...createInitialPlan(),
  walls: [wall(0, 0, 250, 0, "w1"), wall(250, 0, 250, 300, "w2")],
  items,
});

/**
 * Stand in for the canvas: pressing it is what used to lose the typed value,
 * because it clears the selection and unmounts the focused field.
 */
function pressCanvas() {
  const canvas = document.createElement("div");
  document.body.append(canvas);
  fireEvent.pointerDown(canvas);
  canvas.remove();
}

beforeEach(() => {
  useApp.setState({ tool: "select" });
});

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe("WallOptions — click-away commits the typed value", () => {
  it("resizes the selected wall to a length typed then clicked away from", () => {
    useApp.getState().loadPlan(cornerPlan());
    useApp.setState({ selectedWalls: new Set(["w1"]) });
    render(<WallOptions />);

    const input = screen.getByLabelText("Length");
    input.focus();
    fireEvent.change(input, { target: { value: "320" } });
    // Never blurred, never submitted — the value only survives if the
    // click-away path is wired up.
    pressCanvas();

    expect(getWallLength(useApp.getState().plan.walls[0])).toBe(320);
  });

  it("resizes the selected opening to a width typed then clicked away from", () => {
    useApp.getState().loadPlan(cornerPlan([door("w1", 80)]));
    useApp.setState({ selectedItems: new Set(["d1"]) });
    render(<WallOptions />);

    const input = screen.getByLabelText("Width");
    input.focus();
    fireEvent.change(input, { target: { value: "100" } });
    pressCanvas();

    expect(useApp.getState().plan.items[0].wallAttach.length).toBe(100);
  });

  it("leaves the wall alone when the press lands inside the field", () => {
    useApp.getState().loadPlan(cornerPlan());
    useApp.setState({ selectedWalls: new Set(["w1"]) });
    render(<WallOptions />);

    const input = screen.getByLabelText("Length");
    input.focus();
    fireEvent.change(input, { target: { value: "320" } });
    fireEvent.pointerDown(input);

    expect(getWallLength(useApp.getState().plan.walls[0])).toBe(250);
  });

  it("rejects an invalid draft on click-away, as Enter and blur do", () => {
    useApp.getState().loadPlan(cornerPlan());
    useApp.setState({ selectedWalls: new Set(["w1"]) });
    render(<WallOptions />);

    const input = screen.getByLabelText("Length");
    input.focus();
    fireEvent.change(input, { target: { value: "0" } });
    pressCanvas();

    expect(getWallLength(useApp.getState().plan.walls[0])).toBe(250);
  });

  it("adds exactly one undo entry, restoring the previous length", () => {
    useApp.getState().loadPlan(cornerPlan());
    useApp.setState({ selectedWalls: new Set(["w1"]) });
    render(<WallOptions />);

    const input = screen.getByLabelText("Length");
    input.focus();
    fireEvent.change(input, { target: { value: "320" } });
    pressCanvas();
    // The browser blurs the input right after that press, re-running the same
    // commit — it must be a no-op, not a second (or empty) undo entry.
    fireEvent.blur(input);
    expect(getWallLength(useApp.getState().plan.walls[0])).toBe(320);

    useApp.getState().undo();
    expect(getWallLength(useApp.getState().plan.walls[0])).toBe(250);
    // `loadPlan` started a fresh timeline, so a stray entry would show up as a
    // second undo stepping back to 320.
    useApp.getState().undo();
    expect(getWallLength(useApp.getState().plan.walls[0])).toBe(250);
  });
});
