// @vitest-environment jsdom
import { createInitialPlan, type Plan } from "@app/schema";
import { useApp } from "@app/store";
import { DEFAULT_VIEW } from "@app/viewport";
import { buildExportSvg } from "@geometry/exportSvg";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
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
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  useApp.getState().loadPlan(createInitialPlan());
  useApp.getState().setView(() => DEFAULT_VIEW);
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

it("wraps adjacent room names within their own faces at editor zoom", () => {
  const plan = roomPlan();
  const roomNames = [
    { anchor: { x: 90, y: 160 }, name: "Main floor laundry and utility room" },
    {
      anchor: { x: 270, y: 160 },
      name: "Ground floor storage and mechanical room",
    },
  ];
  const resize = ({ x, y }: { x: number; y: number }) => ({
    x: x * 0.9,
    y: (y * 320) / 300,
  });
  const viewScale = 0.95;
  const store = useApp.getState();
  store.setTool("select");
  store.loadPlan({
    ...plan,
    walls: plan.walls.map((wall) => ({
      ...wall,
      a: resize(wall.a),
      b: resize(wall.b),
    })),
    items: [],
    roomNames,
  });
  store.addWall({
    id: "divider",
    a: { x: 180, y: 0 },
    b: { x: 180, y: 320 },
    thickness: 15,
  });
  store.setView(() => ({ ...DEFAULT_VIEW, scale: viewScale }));

  const { container } = render(<FloorPlan />);
  const labels = [...container.querySelectorAll('[data-layer="rooms"] text')];
  expect(labels).toHaveLength(2);
  for (const { name } of roomNames) {
    const label = screen
      .getByRole("button", { name: `${name}, 5.76 m²` })
      .querySelector("text");
    expect(label?.getAttribute("transform")).toContain(
      `scale(${1 / viewScale})`,
    );
    const nameLines = [...label!.querySelectorAll('tspan[font-weight="600"]')];
    const area = label!.querySelector("tspan:last-child")!;
    expect(nameLines).toHaveLength(2);
    expect(nameLines.map((line) => line.textContent).join(" ")).toBe(name);
    expect(area.textContent).toBe("5.76 m²");
    for (const line of [...nameLines, area]) {
      expect(line.hasAttribute("textLength")).toBe(false);
      expect(line.hasAttribute("lengthAdjust")).toBe(false);
    }
  }
});

it.each([
  40, 140,
])("keeps room text inside painted walls with a %icm left wall", (leftThickness) => {
  // jsdom cannot measure painted SVG text. Supply deterministic widths to the
  // same canvas measurement path the editor uses, and compare the rendered
  // rows to the inside edges of the wall polygons it actually drew.
  const measureText = (text: string) => ({ width: text.length * 6.5 });
  vi.stubGlobal("CanvasRenderingContext2D", function CanvasContext() {});
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
    () => ({ measureText }) as CanvasRenderingContext2D,
  );
  const plan = roomPlan();
  const anchor = { x: 65, y: 120 };
  const name = "Ground floor coat and linen storage";
  const resize = ({ x, y }: { x: number; y: number }) => ({
    x: (x * 130) / 400,
    y: (y * 240) / 300,
  });
  const store = useApp.getState();
  store.loadPlan({
    ...plan,
    walls: plan.walls.map((wall) => ({
      ...wall,
      a: resize(wall.a),
      b: resize(wall.b),
      thickness: wall.id === "w3" ? leftThickness : 40,
    })),
    items: [],
    roomNames: [{ anchor, name }],
  });
  store.setTool("select");
  store.setView(() => DEFAULT_VIEW);

  const { container } = render(<FloorPlan />);
  const group = screen.getByRole("button", { name: `${name}, 3.12 m²` });
  const label = group.querySelector("text")!;
  const outline = label.getAttribute("transform")!;
  const [, x, , fontScale] =
    /translate\(([^ ]+) ([^)]+)\) scale\(([^)]+)\)/.exec(outline)!;
  const walls = container.querySelectorAll('[data-layer="walls"] polygon');
  const wallXs = (index: number) =>
    walls[index]
      .getAttribute("points")!
      .split(" ")
      .map((p) => Number(p.split(",")[0]));
  const leftInnerEdge = Math.max(...wallXs(3));
  const rightInnerEdge = Math.min(...wallXs(1));

  expect(rightInnerEdge - leftInnerEdge).toBe(110 - leftThickness / 2);
  expect(label.querySelector('tspan[font-weight="600"]')).not.toBeNull();
  expect(label.querySelector("tspan:last-child")?.textContent).toBe("3.12 m²");
  for (const line of label.querySelectorAll("tspan")) {
    const halfWidth =
      (measureText(line.textContent ?? "").width / 2 + 1.5) * Number(fontScale);
    expect(Number(x) - halfWidth).toBeGreaterThan(leftInnerEdge);
    expect(Number(x) + halfWidth).toBeLessThan(rightInnerEdge);
  }
  expect(useApp.getState().plan.roomNames).toEqual([{ anchor, name }]);
});

it.each([
  {
    width: 180,
    height: 70,
    thickness: 12,
    scale: 1,
    name: "Ground floor coat and linen storage",
    area: "1.26 m²",
    shared: false,
  },
  {
    width: 220,
    height: 240,
    thickness: 16,
    scale: 1,
    name: "Utility room",
    area: "2.64 m²",
    shared: true,
  },
  {
    width: 220,
    height: 240,
    thickness: 16,
    scale: 0.5,
    name: "Utility room",
    area: "2.64 m²",
    shared: true,
  },
])("keeps $name and its area clear of dimensions at $scale×", ({
  width,
  height,
  thickness,
  scale,
  name,
  area,
  shared,
}) => {
  const measureText = (text: string) => ({
    width: text.length * 6,
    actualBoundingBoxAscent: 8,
    actualBoundingBoxDescent: 2,
  });
  vi.stubGlobal("CanvasRenderingContext2D", function CanvasContext() {});
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
    () => ({ measureText }) as CanvasRenderingContext2D,
  );
  const plan = roomPlan();
  const resize = ({ x, y }: { x: number; y: number }) => ({
    x: (x * width) / 400,
    y: (y * height) / 300,
  });
  const store = useApp.getState();
  store.loadPlan({
    ...plan,
    walls: plan.walls.map((wall) => ({
      ...wall,
      a: resize(wall.a),
      b: resize(wall.b),
      thickness,
    })),
    items: [],
    roomNames: [
      { anchor: { x: width * (shared ? 0.75 : 0.5), y: height / 2 }, name },
    ],
  });
  if (shared)
    store.addWall({
      id: "divider",
      a: { x: width / 2, y: 0 },
      b: { x: width / 2, y: height },
      thickness,
    });
  store.setTool("select");
  store.setView(() => ({ ...DEFAULT_VIEW, scale }));

  const { container } = render(<FloorPlan />);
  const label = screen
    .getByRole("button", { name: `${name}, ${area}` })
    .querySelector("text")!;
  const nameLines = [...label.querySelectorAll('tspan[font-weight="600"]')];
  expect(nameLines.length).toBeGreaterThan(0);
  if (shared)
    expect(nameLines.map((row) => row.textContent).join(" ")).toBe(name);
  expect(label.querySelector("tspan:last-child")?.textContent).toBe(area);

  // Apply each rendered label's translate, rotation, and counter-scale to
  // the mocked glyph bounds. jsdom has no SVG layout or getBBox().
  const bounds = (line: SVGElement, alphaBaseline: boolean) => {
    const transform = line.parentElement!.getAttribute("transform")!;
    const [, x, y, rotation, factor] =
      /translate\(([^ ]+) ([^)]+)\)(?: rotate\(([^)]+)\))? scale\(([^)]+)\)/.exec(
        transform,
      )!;
    const radians = (Number(rotation ?? 0) * Math.PI) / 180;
    const cos = Math.cos(radians);
    const sin = Math.sin(radians);
    const halo = 1.5;
    const halfWidth = measureText(line.textContent ?? "").width / 2 + halo;
    const baseline = Number(line.getAttribute("y"));
    const top = baseline - (alphaBaseline ? 8 : 6) - halo;
    const bottom = baseline + (alphaBaseline ? 2 : 6) + halo;
    const corners = [
      [-halfWidth, top],
      [halfWidth, top],
      [halfWidth, bottom],
      [-halfWidth, bottom],
    ].map(([u, v]) => ({
      x: Number(x) + (u * cos - v * sin) * Number(factor),
      y: Number(y) + (u * sin + v * cos) * Number(factor),
    }));
    return {
      left: Math.min(...corners.map((point) => point.x)),
      right: Math.max(...corners.map((point) => point.x)),
      top: Math.min(...corners.map((point) => point.y)),
      bottom: Math.max(...corners.map((point) => point.y)),
    };
  };

  const dimensions = [
    ...container.querySelectorAll<SVGTextElement>(
      '[data-layer="dimensions"] text',
    ),
  ];
  expect(
    dimensions.some(
      (line) => line.textContent === (shared ? "240 cm" : "180 cm"),
    ),
  ).toBe(true);
  for (const line of label.querySelectorAll<SVGTSpanElement>("tspan")) {
    const room = bounds(line, false);
    for (const text of dimensions) {
      const dim = bounds(text, true);
      expect(
        room.right < dim.left ||
          room.left > dim.right ||
          room.bottom < dim.top ||
          room.top > dim.bottom,
      ).toBe(true);
    }
  }
});

it("keeps the full bathroom label below the rendered door swing in the editor and SVG", () => {
  const plan = roomPlan();
  const resize = ({ x, y }: { x: number; y: number }) => ({
    x: (x * 150) / 400,
    y: (y * 220) / 300,
  });
  plan.walls = plan.walls.map((wall) => ({
    ...wall,
    a: resize(wall.a),
    b: resize(wall.b),
    thickness: 12,
  }));
  plan.items = [
    {
      id: "bathroom-door",
      type: "door",
      wallAttach: { wallId: "w3", offset: 118, length: 90 },
      thickness: 20,
      props: { hingeEdge: "start", swingSide: "inside" },
    },
  ];
  plan.roomNames = [{ anchor: { x: 75, y: 110 }, name: "Bathroom" }];
  const store = useApp.getState();
  store.loadPlan(plan);
  store.setView(() => DEFAULT_VIEW);

  const { container } = render(<FloorPlan />);
  const svg = new DOMParser().parseFromString(
    buildExportSvg(plan).markup,
    "image/svg+xml",
  );
  const verify = (root: ParentNode, label: Element, rows: string) => {
    const door = root.querySelector('[data-layer="items"]')!;
    expect(door.querySelector("path")?.getAttribute("d")).toBe(
      "M 0 12 A 90 90 0 0 1 90 102",
    );
    const leaf = door.querySelector("line")!;
    expect(
      ["x1", "y1", "x2", "y2"].map((attr) => leaf.getAttribute(attr)),
    ).toEqual(["0", "102", "90", "102"]);
    const hinge = door.querySelector("circle")!;
    const swingBottom =
      Number(hinge.getAttribute("cy")) + Number(hinge.getAttribute("r"));
    const [, labelY, labelScale] =
      /translate\([^ ]+ ([^)]+)\) scale\(([^)]+)\)/.exec(
        label.getAttribute("transform")!,
      )!;
    const glyphHalfHeight =
      (Number(label.getAttribute("font-size")) +
        Number(label.getAttribute("stroke-width"))) /
      2;
    const lines = [...label.querySelectorAll(rows)];
    expect(lines.map((row) => row.textContent)).toEqual(["Bathroom", "3.3 m²"]);
    for (const line of lines) {
      const top =
        Number(labelY) +
        Number(labelScale) * (Number(line.getAttribute("y")) - glyphHalfHeight);
      expect(top).toBeGreaterThan(swingBottom);
    }
  };
  verify(
    container,
    container.querySelector('[data-layer="rooms"] text')!,
    "tspan",
  );
  verify(svg, svg.querySelector('[data-layer="room-areas"] > g')!, "text");
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
