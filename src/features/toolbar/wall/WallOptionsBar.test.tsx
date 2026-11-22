// @vitest-environment jsdom
//
// The link `selection.test.ts` can't reach: that the bar actually *appears* for
// a selection and that its buttons are *wired* to the store. These mount the
// real bar and click the real buttons, so dropping an `onClick` — or narrowing
// the bar back to a single-item selection — fails them.
import { loadPersistedHistory } from "@app/persistence";
import {
  createInitialPlan,
  type DoorItem,
  isDoor,
  type Plan,
  type Wall,
  type WindowItem,
} from "@app/schema";
import { useApp } from "@app/store";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
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
  it.each([
    { selection: "a label", includeWall: false },
    { selection: "a label and wall", includeWall: true },
  ])("removes $selection in one undo step", ({ includeWall }) => {
    const original = {
      ...plan(),
      labels: [
        { id: "l1", text: "Kitchen", position: { x: 80, y: 50 } },
        { id: "l2", text: "Terrace", position: { x: 500, y: 0 } },
      ],
    };
    const state = useApp.getState;
    state().loadPlan(original);
    state().selectLabels(["l1"]);
    if (includeWall) state().selectWall("w1", true);
    render(<WallOptionsBar />);

    expect(screen.queryAllByRole("spinbutton")).toHaveLength(0);
    if (!includeWall) {
      expect(screen.queryByRole("textbox")).toBeNull();
      act(() =>
        state().setLabelEditor({
          id: "l1",
          position: original.labels[0].position,
        }),
      );
      expect(screen.queryByRole("button", { name: "Remove" })).toBeNull();
      act(() => state().finishLabelEdit());
    }
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));

    expect(state().plan.labels).toEqual([original.labels[1]]);
    expect(state().plan.walls.map(({ id }) => id)).toEqual(
      includeWall ? ["w2"] : ["w1", "w2"],
    );
    expect(loadPersistedHistory()?.past).toHaveLength(1);
    act(() => state().undo());
    expect(state().plan).toEqual(original);
  });

  it.each([
    "wall",
    "label",
  ] as const)("shows actions and hides measurements for a door and %s selection", (kind) => {
    const state = useApp.getState;
    state().loadPlan({
      ...plan([door()]),
      labels: [{ id: "l1", text: "Kitchen", position: { x: 80, y: 50 } }],
    });
    state().selectItem("d1");
    render(<WallOptionsBar />);
    expect(screen.getByRole("spinbutton", { name: "Width" })).toBeTruthy();
    act(() => {
      if (kind === "wall") state().selectWall("w1", true);
      else state().selectLabels(["l1"], true);
    });

    expect(screen.queryAllByRole("spinbutton")).toHaveLength(0);
    expect(screen.getByRole("button", { name: "Remove" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Toggle hinge" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Toggle swing" })).toBeTruthy();
  });

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
