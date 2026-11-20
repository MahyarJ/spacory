// @vitest-environment jsdom
import { createInitialPlan, type Plan } from "@app/schema";
import { useApp } from "@app/store";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { FloorPlan } from "./FloorPlan";

function roomPlan(): Plan {
  const points = [
    { x: 0, y: 0 },
    { x: 400, y: 0 },
    { x: 400, y: 300 },
    { x: 0, y: 300 },
  ];
  return {
    ...createInitialPlan(),
    meta: { ...createInitialPlan().meta, measurementSystem: "metric" },
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
        wallAttach: { wallId: "w0", offset: 100, length: 80 },
        props: { hingeEdge: "start", swingSide: "inside" },
      },
    ],
  };
}

afterEach(() => {
  cleanup();
  useApp.getState().loadPlan(createInitialPlan());
});

it("renders rooms beneath walls, ignores doors, and derives enclosure through delete/undo/redo", () => {
  useApp.getState().loadPlan(roomPlan());
  const planBeforeRender = JSON.stringify(useApp.getState().plan);
  const { container } = render(<FloorPlan />);
  const layer = container.querySelector('[data-layer="rooms"]')!;
  expect(layer.textContent).toBe("12 m²");
  expect(layer.querySelectorAll("polygon")).toHaveLength(1);
  expect((layer as SVGElement).style.pointerEvents).toBe("none");
  expect(layer.nextElementSibling?.getAttribute("data-layer")).toBe("walls");
  expect(JSON.stringify(useApp.getState().plan)).toBe(planBeforeRender);

  act(() => {
    useApp.setState({ selectedWalls: new Set(["w2"]) });
    useApp.getState().deleteSelected();
  });
  expect(layer.textContent).toBe("");
  expect(layer.querySelectorAll("polygon")).toHaveLength(0);
  act(() => useApp.getState().undo());
  expect(layer.textContent).toBe("12 m²");
  act(() => useApp.getState().redo());
  expect(layer.textContent).toBe("");
});

it("updates area from live wall arrays, converts units, and counter-scales labels", () => {
  useApp.getState().loadPlan(roomPlan());
  const { container } = render(<FloorPlan />);
  const layer = container.querySelector('[data-layer="rooms"]')!;
  act(() => {
    const plan = useApp.getState().plan;
    useApp.setState({
      plan: {
        ...plan,
        walls: plan.walls.map((w) => ({
          ...w,
          a: { x: w.a.x * 2, y: w.a.y },
          b: { x: w.b.x * 2, y: w.b.y },
        })),
      },
    });
    useApp.getState().setView((view) => ({ ...view, scale: 2 }));
  });
  expect(layer.textContent).toBe("24 m²");
  expect(layer.querySelector("text")?.getAttribute("transform")).toContain(
    "scale(0.5)",
  );
  act(() => {
    const plan = useApp.getState().plan;
    useApp.setState({
      plan: { ...plan, meta: { ...plan.meta, measurementSystem: "imperial" } },
    });
  });
  expect(layer.textContent).toBe("258.33 ft²");
});

it("restores both names after a shared wall or an exterior boundary is rebuilt", () => {
  const plan = roomPlan();
  const kitchen = { anchor: { x: 100, y: 150 }, name: "Kitchen" };
  const dining = { anchor: { x: 300, y: 150 }, name: "Dining room" };
  const roomNames = [kitchen, dining];
  const divider = {
    id: "divider",
    a: { x: 200, y: 0 },
    b: { x: 200, y: 300 },
    thickness: 10,
  };
  const outside = plan.walls[1];
  const store = useApp.getState();
  store.loadPlan({ ...plan, roomNames });
  store.setTool("select");
  store.addWall(divider);
  const { container } = render(<FloorPlan />);
  const layer = container.querySelector('[data-layer="rooms"]')!;
  const names = () =>
    [...layer.querySelectorAll("text")]
      .map((label) => label.textContent)
      .sort();
  const removeWall = (id: string) => {
    store.selectWall(id);
    store.deleteSelected();
  };

  expect(names()).toEqual(["Dining room6 m²", "Kitchen6 m²"]);
  act(() => removeWall(divider.id));
  expect(names()).toEqual(["Kitchen12 m²"]);
  expect(useApp.getState().plan.roomNames).toEqual(roomNames);
  act(() => store.undo());
  expect(names()).toEqual(["Dining room6 m²", "Kitchen6 m²"]);
  act(() => store.redo());
  expect(names()).toEqual(["Kitchen12 m²"]);
  act(() => {
    store.selectRoom(kitchen.anchor);
    store.setSelectedRoomName("");
  });
  expect(names()).toEqual(["Dining room12 m²"]);
  expect(useApp.getState().plan.roomNames).toEqual([dining]);
  act(() => store.undo());
  expect(names()).toEqual(["Kitchen12 m²"]);

  act(() => removeWall(outside.id));
  expect(names()).toEqual([]);
  expect(useApp.getState().plan.roomNames).toEqual(roomNames);
  act(() => store.addWall(outside));
  expect(names()).toEqual(["Kitchen12 m²"]);
  act(() => store.addWall(divider));
  expect(names()).toEqual(["Dining room6 m²", "Kitchen6 m²"]);
});
