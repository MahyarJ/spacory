// @vitest-environment jsdom

import { parsePlan, serializePlan } from "@app/io";
import { loadPersistedHistory } from "@app/persistence";
import { createInitialPlan, type Plan } from "@app/schema";
import { useApp } from "@app/store";
import { DimensionsLayer } from "@features/canvas/DimensionsLayer";
import { RoomsLayer } from "@features/canvas/RoomsLayer";
import { getWallLength, MIN_WALL_LENGTH } from "@geometry/wall";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it } from "vitest";
import { Toolbar } from "./Toolbar";
import { WallOptions } from "./wall/WallOptions";

function plan(): Plan {
  const points = [
    { x: 0, y: 0 },
    { x: 400, y: 0 },
    { x: 400, y: 300 },
    { x: 0, y: 300 },
  ];
  return {
    ...createInitialPlan(),
    walls: points.map((a, i) => ({
      id: `w${i}`,
      a,
      b: points[(i + 1) % 4],
      thickness: 10,
    })),
    items: [
      {
        id: "door",
        type: "door",
        thickness: 10,
        wallAttach: { wallId: "w0", offset: 50, length: 80 },
        props: { hingeEdge: "start", swingSide: "inside" },
      },
    ],
  };
}
function mount() {
  return render(
    <>
      <Toolbar />
      <WallOptions />
      <svg aria-label="Floor plan" role="img">
        <DimensionsLayer />
        <RoomsLayer />
      </svg>
    </>,
  );
}
function switchTo(name: string) {
  const button = screen.getByRole("button", { name });
  fireEvent.pointerDown(button);
  fireEvent.click(button);
}
beforeEach(() => {
  useApp.getState().loadPlan(plan());
  useApp.getState().setWallThicknessPreset("standard");
  useApp.setState({ tool: "select", selectedWalls: new Set(["w0"]) });
});
afterEach(() => {
  cleanup();
  localStorage.clear();
});

it("switches lengths and room areas together, persists the plan, and supports undo/redo", () => {
  const before = useApp.getState().plan;
  const view = useApp.getState().view;
  const { container } = mount();
  expect(
    screen.getByRole("button", { name: "Metric" }).getAttribute("aria-pressed"),
  ).toBe("true");
  expect(container.querySelector('[data-layer="rooms"]')?.textContent).toBe(
    "12 m²",
  );
  switchTo("Imperial");
  expect(
    container.querySelector('[data-layer="dimensions"]')?.textContent,
  ).toContain("13′ 1.5″");
  expect(container.querySelector('[data-layer="rooms"]')?.textContent).toBe(
    "129.17 ft²",
  );
  expect((screen.getByLabelText("Length feet") as HTMLInputElement).value).toBe(
    "13",
  );
  expect(
    (screen.getByLabelText("Length inches") as HTMLInputElement).value,
  ).toBe("1.5");
  expect(useApp.getState().plan.walls).toEqual(before.walls);
  expect(useApp.getState().plan.items).toEqual(before.items);
  expect(useApp.getState().plan.meta.gridSize).toBe(before.meta.gridSize);
  expect(useApp.getState().view).toEqual(view);
  expect(loadPersistedHistory()?.present.meta.measurementSystem).toBe(
    "imperial",
  );
  expect(
    parsePlan(serializePlan(useApp.getState().plan)).meta.measurementSystem,
  ).toBe("imperial");
  expect(loadPersistedHistory()?.past).toHaveLength(1);
  switchTo("Imperial");
  expect(loadPersistedHistory()?.past).toHaveLength(1);
  act(() => useApp.getState().undo());
  expect(screen.getByLabelText("Length")).toBeTruthy();
  expect(container.querySelector('[data-layer="rooms"]')?.textContent).toBe(
    "12 m²",
  );
  act(() => useApp.getState().redo());
  expect(screen.getByLabelText("Length feet")).toBeTruthy();
});

it("commits a pending metric edit before switching, as a separate undo step", () => {
  mount();
  const input = screen.getByLabelText("Length");
  input.focus();
  fireEvent.change(input, { target: { value: "350" } });
  switchTo("Imperial");
  expect(getWallLength(useApp.getState().plan.walls[0])).toBe(350);
  expect(loadPersistedHistory()?.past).toHaveLength(2);
  act(() => useApp.getState().undo());
  expect(useApp.getState().plan.meta.measurementSystem).toBe("metric");
  expect(getWallLength(useApp.getState().plan.walls[0])).toBe(350);
  act(() => useApp.getState().undo());
  expect(getWallLength(useApp.getState().plan.walls[0])).toBe(400);
});

it("edits feet and inches together and commits in the original system before switching", () => {
  mount();
  switchTo("Imperial");
  const feet = screen.getByLabelText("Length feet");
  const inches = screen.getByLabelText("Length inches");
  feet.focus();
  fireEvent.change(feet, { target: { value: "8" } });
  fireEvent.blur(feet, { relatedTarget: inches });
  inches.focus();
  expect(getWallLength(useApp.getState().plan.walls[0])).toBe(400);
  fireEvent.change(inches, { target: { value: "6" } });
  switchTo("Metric");
  expect(getWallLength(useApp.getState().plan.walls[0])).toBeCloseTo(259.08);
});

it("does not resize an untouched rounded length or add history on blur", () => {
  mount();
  switchTo("Imperial");
  const before = useApp.getState().plan;
  const input = screen.getByLabelText("Length inches");
  input.focus();
  fireEvent.blur(input);
  expect(useApp.getState().plan).toBe(before);
  switchTo("Metric");
  expect(useApp.getState().plan.walls).toEqual(before.walls);
});

it("rejects invalid imperial drafts before switching", () => {
  mount();
  switchTo("Imperial");
  const feet = screen.getByLabelText("Length feet");
  feet.focus();
  fireEvent.change(feet, { target: { value: "-1" } });
  switchTo("Metric");
  expect(getWallLength(useApp.getState().plan.walls[0])).toBe(400);
  expect((screen.getByLabelText("Length") as HTMLInputElement).value).toBe(
    "400",
  );
});

it("validates imperial lengths against the centimetre minimum", () => {
  mount();
  switchTo("Imperial");
  const feet = screen.getByLabelText("Length feet");
  const inches = screen.getByLabelText("Length inches");
  fireEvent.change(feet, { target: { value: "0" } });
  fireEvent.change(inches, {
    target: { value: String(MIN_WALL_LENGTH / 2.54 / 2) },
  });
  fireEvent.submit(inches.closest("form")!);
  expect(getWallLength(useApp.getState().plan.walls[0])).toBe(400);
  expect((feet as HTMLInputElement).value).toBe("13");
});

it("converts opening width entries and thickness preset labels", () => {
  useApp.setState({
    selectedWalls: new Set(),
    selectedItems: new Set(["door"]),
  });
  mount();
  switchTo("Imperial");
  fireEvent.change(screen.getByLabelText("Width feet"), {
    target: { value: "3" },
  });
  const inches = screen.getByLabelText("Width inches");
  fireEvent.change(inches, { target: { value: "0" } });
  fireEvent.submit(inches.closest("form")!);
  expect(useApp.getState().plan.items[0].wallAttach.length).toBeCloseTo(91.44);
  act(() => useApp.getState().setTool("wall"));
  const preset = screen.getByRole("button", { name: "4½″" });
  fireEvent.click(preset);
  expect(useApp.getState().currentWallThickness).toBeCloseTo(11.43);
});

it("commits both imperial inputs on Enter without waiting for blur", () => {
  mount();
  switchTo("Imperial");
  fireEvent.change(screen.getByLabelText("Length feet"), {
    target: { value: "8" },
  });
  const inches = screen.getByLabelText("Length inches");
  fireEvent.change(inches, { target: { value: "6" } });
  fireEvent.keyDown(inches, { key: "Enter" });
  expect(getWallLength(useApp.getState().plan.walls[0])).toBeCloseTo(259.08);
  expect(loadPersistedHistory()?.past).toHaveLength(2);
  fireEvent.blur(inches);
  expect(loadPersistedHistory()?.past).toHaveLength(2);
});

it("keeps corresponding presets selected through system changes and undo/redo", () => {
  useApp.setState({ tool: "wall", currentWallThickness: 10 });
  mount();
  expect(
    screen.getByRole("button", { name: "10 cm" }).getAttribute("aria-pressed"),
  ).toBe("true");
  fireEvent.click(screen.getByRole("button", { name: "15 cm" }));
  expect(useApp.getState().currentWallThickness).toBe(15);
  const walls = useApp.getState().plan.walls;
  switchTo("Imperial");
  expect(screen.queryByRole("button", { name: "15 cm" })).toBeNull();
  expect(
    screen.getByRole("button", { name: "6½″" }).getAttribute("aria-pressed"),
  ).toBe("true");
  expect(useApp.getState().currentWallThickness).toBeCloseTo(16.51);
  fireEvent.click(screen.getByRole("button", { name: "6½″" }));
  expect(useApp.getState().currentWallThickness).toBeCloseTo(16.51);
  expect(screen.queryByLabelText("Custom thickness")).toBeNull();
  switchTo("Metric");
  expect(useApp.getState().currentWallThickness).toBe(15);
  expect(
    screen.getByRole("button", { name: "15 cm" }).getAttribute("aria-pressed"),
  ).toBe("true");
  act(() => useApp.getState().undo());
  expect(
    screen.getByRole("button", { name: "6½″" }).getAttribute("aria-pressed"),
  ).toBe("true");
  act(() => useApp.getState().redo());
  expect(
    screen.getByRole("button", { name: "15 cm" }).getAttribute("aria-pressed"),
  ).toBe("true");
  expect(useApp.getState().plan.walls).toEqual(walls);
});

it("edits custom overall thickness in cm or inches, rejects invalid entries, and preserves rounded values", () => {
  useApp.setState({ tool: "wall", currentWallThickness: 10 });
  mount();
  fireEvent.click(screen.getByRole("button", { name: "Custom" }));
  let input = screen.getByLabelText("Custom thickness");
  fireEvent.change(input, { target: { value: "12.5" } });
  fireEvent.keyDown(input, { key: "Enter" });
  expect(useApp.getState().currentWallThickness).toBe(12.5);
  switchTo("Imperial");
  input = screen.getByLabelText("Custom thickness");
  input.focus();
  fireEvent.blur(input);
  expect(useApp.getState().currentWallThickness).toBe(12.5);
  fireEvent.change(input, { target: { value: "0.1" } });
  fireEvent.keyDown(input, { key: "Enter" });
  expect(useApp.getState().currentWallThickness).toBe(12.5);
  expect((input as HTMLInputElement).value).toBe("4.92");
  fireEvent.change(input, { target: { value: "8" } });
  fireEvent.keyDown(input, { key: "Enter" });
  expect(useApp.getState().currentWallThickness).toBeCloseTo(20.32);
  expect(screen.queryByLabelText("Custom thickness feet")).toBeNull();
});

it("keeps Custom selected even when its value happens to equal a preset", () => {
  useApp.setState({ tool: "wall" });
  mount();
  fireEvent.click(screen.getByRole("button", { name: "Custom" }));
  switchTo("Imperial");
  expect(useApp.getState().currentWallThickness).toBe(10);
  expect(
    screen.getByRole("button", { name: "Custom" }).getAttribute("aria-pressed"),
  ).toBe("true");
  switchTo("Metric");
  expect(
    screen.getByRole("button", { name: "Custom" }).getAttribute("aria-pressed"),
  ).toBe("true");
  expect(useApp.getState().currentWallThickness).toBe(10);
  fireEvent.click(screen.getByRole("button", { name: "10 cm" }));
  switchTo("Imperial");
  expect(
    screen.getByRole("button", { name: "4½″" }).getAttribute("aria-pressed"),
  ).toBe("true");
  expect(useApp.getState().currentWallThickness).toBeCloseTo(11.43);
  switchTo("Metric");
  expect(
    screen.getByRole("button", { name: "10 cm" }).getAttribute("aria-pressed"),
  ).toBe("true");
});
