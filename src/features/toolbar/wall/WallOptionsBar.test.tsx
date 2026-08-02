// @vitest-environment jsdom
//
// The link `selection.test.ts` can't reach: that the bar actually *appears* for
// a selection and that its buttons are *wired* to the store. These mount the
// real bar and click the real buttons, so dropping an `onClick` — or narrowing
// the bar back to a single-item selection — fails them.
import {
  createInitialPlan,
  type DoorItem,
  isDoor,
  type Plan,
  type Wall,
  type WindowItem,
} from "@app/schema";
import { useApp } from "@app/store";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WallOptionsBar } from "./WallOptionsBar";

const wall = (id: string, bx: number): Wall => ({
  id,
  a: { x: 0, y: 0 },
  b: { x: bx, y: 0 },
  thickness: 10,
});

const door = (): DoorItem => ({
  id: "d1",
  type: "door",
  thickness: 10,
  wallAttach: { wallId: "w1", offset: 40, length: 80 },
  props: { hingeEdge: "start", swingSide: "outside" },
});

const window_ = (): WindowItem => ({
  id: "n1",
  type: "window",
  thickness: 10,
  wallAttach: { wallId: "w1", offset: 140, length: 80 },
  props: {},
});

/** Two walls plus whatever openings a case needs — a real plan, not a lone wall. */
const plan = (items: Plan["items"] = []): Plan => ({
  ...createInitialPlan(),
  walls: [wall("w1", 250), wall("w2", 300)],
  items,
});

const theDoor = () => {
  const item = useApp.getState().plan.items.find(isDoor);
  if (!item) throw new Error("expected a door in the plan");
  return item;
};

beforeEach(() => {
  useApp.setState({ tool: "select" });
});

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe("WallOptionsBar — on-screen selection actions", () => {
  it("removes a multi-selection of walls, the case a marquee produces", () => {
    useApp.getState().loadPlan(plan());
    useApp.setState({ selectedWalls: new Set(["w1", "w2"]) });
    render(<WallOptionsBar />);

    fireEvent.click(screen.getByLabelText("Remove"));

    expect(useApp.getState().plan.walls).toEqual([]);
    expect(useApp.getState().selectedWalls.size).toBe(0);
  });

  it("removes the selected wall and undoes in a single step", () => {
    useApp.getState().loadPlan(plan());
    useApp.setState({ selectedWalls: new Set(["w1"]) });
    render(<WallOptionsBar />);

    fireEvent.click(screen.getByLabelText("Remove"));
    expect(useApp.getState().plan.walls.map((w) => w.id)).toEqual(["w2"]);

    useApp.getState().undo();
    expect(useApp.getState().plan.walls.map((w) => w.id)).toEqual(["w1", "w2"]);
    // `loadPlan` started a fresh timeline, so a second write path would show up
    // here as another undo stepping back to the deleted state.
    useApp.getState().undo();
    expect(useApp.getState().plan.walls.map((w) => w.id)).toEqual(["w1", "w2"]);
  });

  it("flips the selected door's hinge edge", () => {
    useApp.getState().loadPlan(plan([door()]));
    useApp.setState({ selectedItems: new Set(["d1"]) });
    render(<WallOptionsBar />);

    expect(theDoor().props.hingeEdge).toBe("start");
    fireEvent.click(screen.getByLabelText("Toggle hinge"));
    expect(theDoor().props.hingeEdge).toBe("end");
  });

  it("flips the selected door's swing side", () => {
    useApp.getState().loadPlan(plan([door()]));
    useApp.setState({ selectedItems: new Set(["d1"]) });
    render(<WallOptionsBar />);

    expect(theDoor().props.swingSide).toBe("outside");
    fireEvent.click(screen.getByLabelText("Toggle swing"));
    expect(theDoor().props.swingSide).toBe("inside");
  });

  it("names each accelerator in the tooltip", () => {
    useApp.getState().loadPlan(plan([door()]));
    useApp.setState({ selectedItems: new Set(["d1"]) });
    render(<WallOptionsBar />);

    const title = (name: string) =>
      screen.getByLabelText(name).getAttribute("title");
    expect(title("Remove")).toBe("Remove (Delete)");
    expect(title("Toggle hinge")).toBe("Toggle hinge (H)");
    expect(title("Toggle swing")).toBe("Toggle swing (S)");
  });

  it("offers no hinge or swing for a window — it has neither", () => {
    useApp.getState().loadPlan(plan([window_()]));
    useApp.setState({ selectedItems: new Set(["n1"]) });
    render(<WallOptionsBar />);

    expect(screen.queryByLabelText("Remove")).not.toBeNull();
    expect(screen.queryByLabelText("Toggle hinge")).toBeNull();
    expect(screen.queryByLabelText("Toggle swing")).toBeNull();
  });

  it("shows no bar at all when nothing is selected", () => {
    useApp.getState().loadPlan(plan());
    render(<WallOptionsBar />);

    expect(screen.queryByLabelText("Remove")).toBeNull();
  });

  it("keeps the actions out of the other tools' bars", () => {
    useApp.getState().loadPlan(plan());
    useApp.setState({ tool: "wall", selectedWalls: new Set(["w1"]) });
    render(<WallOptionsBar />);

    // The wall tool's own bar is still there…
    expect(screen.queryByText("Thickness")).not.toBeNull();
    // …but a selection that outlived the tool switch doesn't drag the actions in.
    expect(screen.queryByLabelText("Remove")).toBeNull();
  });
});
