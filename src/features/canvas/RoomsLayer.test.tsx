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
    meta: { ...createInitialPlan().meta, units: "m" },
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
    useApp.setState({ plan: { ...plan, meta: { ...plan.meta, units: "ft" } } });
  });
  expect(layer.textContent).toBe("258.33 ft²");
});
