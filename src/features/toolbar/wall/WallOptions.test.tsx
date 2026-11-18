// @vitest-environment jsdom
//
// Exercise the real editor and canvas because the pure draft helpers cannot
// verify focus, resize controls, or preview rendering.
import { HISTORY_STORAGE_KEY } from "@app/persistence";
import {
  createInitialPlan,
  type DoorItem,
  type Plan,
  type Wall,
} from "@app/schema";
import { useApp } from "@app/store";
import { FloorPlan } from "@features/canvas/FloorPlan";
import { getWallLength } from "@geometry/wall";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WallOptions } from "./WallOptions";
import { WallOptionsBar } from "./WallOptionsBar";

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

describe("WallOptions — resize preview", () => {
  function setup(id = "bottom") {
    const plan = {
      ...cornerPlan(),
      walls: [
        wall(0, 0, 400, 0, "bottom"),
        wall(400, 0, 400, 300, "right"),
        wall(400, 300, 0, 300, "top"),
        wall(0, 300, 0, 0, "left"),
      ],
    };
    useApp.getState().loadPlan(plan);
    useApp.getState().selectWall(id);
    const { container } = render(
      <>
        <FloorPlan />
        <WallOptionsBar />
      </>,
    );
    const input = screen.getByLabelText("Length");
    return {
      container,
      input,
      setDraft: (value: string) =>
        fireEvent.change(input, { target: { value } }),
      preview: () =>
        container.querySelector('[data-layer="wall-resize-preview"]'),
    };
  }

  it("previews both neighboring walls, then applies the chosen anchor on click-away", () => {
    const { container, input, setDraft, preview } = setup();
    const before = useApp.getState().plan;
    const saved = localStorage.getItem(HISTORY_STORAGE_KEY);
    const status = screen.getByRole("status");
    const bar = status.previousElementSibling;
    expect(bar?.contains(input)).toBe(true);
    expect(bar?.contains(screen.getByRole("button", { name: "Remove" }))).toBe(
      true,
    );
    expect(bar?.querySelectorAll("input")).toHaveLength(1);
    expect(screen.queryByRole("group", { name: "Move" })).toBeNull();
    expect(status.textContent).toBe("");
    act(() => input.focus());
    expect(preview()?.querySelectorAll("path")).toHaveLength(2);
    expect(preview()?.querySelectorAll("polygon")).toHaveLength(0);
    expect(
      screen.getByRole("button", { name: "Both", pressed: true }),
    ).toBeTruthy();

    setDraft("500");
    expect(status.textContent).toBe(
      "Grow by 100 cm across both ends (400 cm → 500 cm)",
    );
    expect(
      Array.from(
        preview()!.querySelectorAll("polygon"),
        (polygon) => polygon.dataset.wallId,
      ),
    ).toEqual(["bottom", "right", "left"]);
    expect(
      preview()
        ?.querySelector('[data-resize-end="a"]')
        ?.getAttribute("transform"),
    ).toContain("rotate(180)");

    const moveRight = screen.getByRole("button", { name: "Right" });
    fireEvent.pointerDown(moveRight);
    fireEvent.mouseDown(moveRight);
    expect(document.activeElement).toBe(moveRight);
    expect(fireEvent.keyDown(moveRight, { key: "Enter" })).toBe(true);
    expect(useApp.getState().plan).toBe(before);
    fireEvent.click(moveRight);
    act(() => input.focus());
    expect((input as HTMLInputElement).value).toBe("500");
    act(() => moveRight.focus());
    expect(useApp.getState().plan).toBe(before);
    expect(localStorage.getItem(HISTORY_STORAGE_KEY)).toBe(saved);
    expect(preview()?.querySelectorAll("path")).toHaveLength(1);
    expect(screen.getByRole("status").textContent).toBe(
      "Grow by 100 cm at the right end (400 cm → 500 cm)",
    );
    expect(preview()?.querySelector('[data-wall-id="left"]')).toBeNull();
    const rightPreview = preview()
      ?.querySelector('[data-wall-id="right"]')
      ?.getAttribute("points");
    expect(rightPreview).toBeTruthy();

    pressCanvas();
    expect(preview()).toBeNull();
    expect(useApp.getState().plan.walls[0]).toEqual(
      wall(0, 0, 500, 0, "bottom"),
    );
    expect(status.textContent).toBe("");
    expect(
      container
        .querySelectorAll('[data-layer="walls"] polygon')[1]
        .getAttribute("points"),
    ).toBe(rightPreview);
    act(() => useApp.getState().undo());
    expect(useApp.getState().plan).toEqual(before);
  });

  it("points inward for a shrink, clears invalid geometry, and cancels with Escape", () => {
    const { input, setDraft, preview } = setup();
    const before = useApp.getState().plan;
    const saved = localStorage.getItem(HISTORY_STORAGE_KEY);

    act(() => input.focus());
    setDraft("300");
    expect(preview()?.querySelectorAll("polygon")).toHaveLength(3);
    expect(
      preview()
        ?.querySelector('[data-resize-end="a"]')
        ?.getAttribute("transform"),
    ).toContain("rotate(0)");
    expect(
      preview()
        ?.querySelector('[data-resize-end="b"]')
        ?.getAttribute("transform"),
    ).toContain("rotate(180)");
    setDraft("0");
    expect(screen.getByRole("status").textContent).toBe("");
    expect(preview()?.querySelectorAll("polygon")).toHaveLength(0);
    expect(preview()?.querySelectorAll("path")).toHaveLength(2);
    setDraft("350");
    const moveRight = screen.getByRole("button", { name: "Right" });
    act(() => moveRight.focus());
    fireEvent.click(moveRight);
    expect(screen.getByRole("status").textContent).toBe(
      "Shrink by 50 cm at the right end (400 cm → 350 cm)",
    );
    fireEvent.keyDown(moveRight, { key: "Escape" });

    expect(preview()).toBeNull();
    expect((input as HTMLInputElement).value).toBe("400");
    expect(useApp.getState().plan).toBe(before);
    expect(localStorage.getItem(HISTORY_STORAGE_KEY)).toBe(saved);

    act(() => input.focus());
    expect(
      screen.getByRole("button", { name: "Both", pressed: true }),
    ).toBeTruthy();
    setDraft("300");
    fireEvent.keyDown(input, { key: "Enter" });
    expect(useApp.getState().plan.walls[0]).toEqual(
      wall(50, 0, 350, 0, "bottom"),
    );
    expect(preview()).toBeNull();
  });

  it("labels vertical anchors by position and commits when focus leaves the field", () => {
    const { input, setDraft, preview } = setup("left");
    act(() => input.focus());
    setDraft("400");
    const moveBottom = screen.getByRole("button", { name: "Bottom" });
    expect(screen.getByRole("button", { name: "Top" })).toBeTruthy();
    act(() => moveBottom.focus());
    fireEvent.click(moveBottom);
    expect(screen.getByRole("status").textContent).toBe(
      "Grow by 100 cm at the bottom end (300 cm → 400 cm)",
    );
    act(() => screen.getByRole("button", { name: "Remove" }).focus());
    expect(useApp.getState().plan.walls[3]).toEqual(wall(0, 400, 0, 0, "left"));
    expect(preview()).toBeNull();
  });

  it.each([
    false,
    true,
  ])("defaults to the free end at a one-ended junction (unsplit host: %s)", (unsplit) => {
    const plan = cornerPlan();
    if (unsplit) plan.walls[1] = wall(250, -150, 250, 300, "w2");
    useApp.getState().loadPlan(plan);
    useApp.getState().selectWall("w1");
    const { container } = render(
      <>
        <FloorPlan />
        <WallOptions />
      </>,
    );
    const input = screen.getByLabelText("Length");
    act(() => input.focus());
    const left = screen.getByRole<HTMLButtonElement>("button", {
      name: "Left",
      pressed: true,
    });
    expect(left.disabled).toBe(false);
    expect(
      screen.getByRole<HTMLButtonElement>("button", { name: "Both" }).disabled,
    ).toBe(false);
    expect(
      screen.getByRole<HTMLButtonElement>("button", { name: "Right" }).disabled,
    ).toBe(false);
    expect(container.querySelectorAll("[data-resize-end]")).toHaveLength(1);
    expect(container.querySelector('[data-resize-end="a"]')).toBeTruthy();
    fireEvent.change(input, { target: { value: "320" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(useApp.getState().plan.walls[0]).toEqual(wall(-70, 0, 250, 0, "w1"));
  });

  it("allows moving the joined end and follows the junction when applied", () => {
    useApp.getState().loadPlan(cornerPlan());
    useApp.getState().selectWall("w1");
    render(<WallOptions />);
    const input = screen.getByLabelText("Length");
    act(() => input.focus());
    fireEvent.change(input, { target: { value: "320" } });
    fireEvent.click(screen.getByRole("button", { name: "Right" }));
    expect(
      screen.getByRole("button", { name: "Right", pressed: true }),
    ).toBeTruthy();
    fireEvent.keyDown(input, { key: "Enter" });
    expect(useApp.getState().plan.walls).toEqual([
      wall(0, 0, 320, 0, "w1"),
      wall(320, 0, 250, 300, "w2"),
    ]);
    fireEvent.pointerDown(input);
    expect(
      screen.getByRole("button", { name: "Left", pressed: true }),
    ).toBeTruthy();
  });

  it("defaults to Both for a detached wall and allows either end", () => {
    const plan = cornerPlan();
    plan.walls.push(wall(0, 500, 250, 500, "detached"));
    useApp.getState().loadPlan(plan);
    useApp.getState().selectWall("detached");
    const { container } = render(
      <>
        <FloorPlan />
        <WallOptions />
      </>,
    );
    act(() => screen.getByLabelText("Length").focus());
    expect(
      screen.getByRole<HTMLButtonElement>("button", {
        name: "Both",
        pressed: true,
      }).disabled,
    ).toBe(false);
    expect(
      screen.getByRole<HTMLButtonElement>("button", { name: "Left" }).disabled,
    ).toBe(false);
    expect(
      screen.getByRole<HTMLButtonElement>("button", { name: "Right" }).disabled,
    ).toBe(false);
    expect(container.querySelectorAll("[data-resize-end]")).toHaveLength(2);
  });
});
