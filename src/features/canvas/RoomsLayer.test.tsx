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

it("updates area from live wall arrays, converts units, and scales area with the plan", () => {
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
  const area = layer.querySelector("text")!;
  expect(area.getAttribute("transform")).toBe("translate(400 150)");
  expect(area.getAttribute("font-size")).toBe("24");
  expect(area.getAttribute("font-weight")).toBe("400");
  act(() => useApp.getState().setView(() => ({ ...DEFAULT_VIEW, scale: 0.5 })));
  expect(area.getAttribute("transform")).toBe("translate(400 150)");
  expect(
    Number(area.getAttribute("font-size")) * useApp.getState().view.scale,
  ).toBe(12);
  act(() => {
    const plan = useApp.getState().plan;
    useApp.setState({
      plan: { ...plan, meta: { ...plan.meta, measurementSystem: "imperial" } },
    });
  });
  expect(layer.textContent).toBe("258.33 ft²");
});

it("keeps wrapped room names fixed through pan and zoom and matches export layout", () => {
  const plan = roomPlan();
  const roomNames = [
    { anchor: { x: 90, y: 160 }, name: "Main floor laundry and utility room" },
    {
      anchor: { x: 510, y: 160 },
      name: "Ground floor storage and mechanical room",
    },
  ];
  const resize = ({ x, y }: { x: number; y: number }) => ({
    x: x * 1.7,
    y: (y * 320) / 300,
  });
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
    a: { x: 340, y: 0 },
    b: { x: 340, y: 320 },
    thickness: 15,
  });
  store.setView(() => DEFAULT_VIEW);

  const { container } = render(<FloorPlan />);
  const labels = [...container.querySelectorAll('[data-layer="rooms"] text')];
  expect(labels).toHaveLength(2);
  const svg = new DOMParser().parseFromString(
    buildExportSvg(useApp.getState().plan).markup,
    "image/svg+xml",
  );
  const exported = [...svg.querySelectorAll('[data-layer="room-areas"] > g')];
  expect(exported).toHaveLength(2);
  for (const [index, { name }] of roomNames.entries()) {
    const label = screen
      .getByRole("button", { name: `${name}, 10.88 m²` })
      .querySelector("text");
    expect(label?.getAttribute("transform")).toBe(
      exported[index].getAttribute("transform"),
    );
    expect(label?.getAttribute("font-family")).toBe(
      exported[index].getAttribute("font-family"),
    );
    const nameLines = [...label!.querySelectorAll('tspan[font-weight="600"]')];
    const area = label!.querySelector("tspan:last-child")!;
    expect(nameLines).toHaveLength(2);
    expect(nameLines.map((line) => line.textContent).join(" ")).toBe(name);
    expect(area.textContent).toBe("10.88 m²");
    expect(
      [...exported[index].querySelectorAll("text")].map((line) => [
        line.textContent,
        line.getAttribute("y"),
      ]),
    ).toEqual(
      [...nameLines, area].map((line) => [
        line.textContent,
        line.getAttribute("y"),
      ]),
    );
    for (const line of [...nameLines, area]) {
      expect(line.hasAttribute("textLength")).toBe(false);
      expect(line.hasAttribute("lengthAdjust")).toBe(false);
    }
  }
  const original = labels.map((label) => label.outerHTML);
  for (const scale of [0.25, 0.5, 3]) {
    act(() => store.setView(() => ({ scale, panX: 30, panY: -40 })));
    expect(
      [...container.querySelectorAll('[data-layer="rooms"] text')].map(
        (label) => label.outerHTML,
      ),
    ).toEqual(original);
    expect(
      labels[0]
        .closest('[data-layer="rooms"]')
        ?.parentElement?.getAttribute("transform"),
    ).toBe(`translate(30 -40) scale(${scale})`);
  }
});

it("renders the text hierarchy at 50% zoom", () => {
  const plan = roomPlan();
  plan.walls.push(
    ...roomPlan().walls.map(({ id, a, b, thickness }) => ({
      id: `other-${id}`,
      a: { x: a.x + 500, y: a.y },
      b: { x: b.x + 500, y: b.y },
      thickness,
    })),
  );
  plan.roomNames = [{ anchor: { x: 200, y: 150 }, name: "Vestibule" }];
  plan.labels = [
    { id: "outside", position: { x: 450, y: 200 }, text: "Outside" },
  ];
  const store = useApp.getState();
  store.loadPlan(plan);
  store.setView(() => ({ ...DEFAULT_VIEW, scale: 0.5 }));
  const { container } = render(<FloorPlan />);
  const [named, unnamed] = container.querySelectorAll(
    '[data-layer="rooms"] text',
  );
  expect(named.getAttribute("transform")).toBe("translate(200 150)");
  expect(unnamed.getAttribute("transform")).toBe("translate(700 150)");
  const name = named.querySelector('tspan[font-weight="600"]');
  const free = container.querySelector('[data-layer="plan-labels"] text');
  expect(name?.textContent).toBe("Vestibule");
  expect(Number(named.getAttribute("font-size")) * 0.5).toBe(14);
  expect(Number(free?.getAttribute("font-size")) * 0.5).toBe(14);
  expect(free?.getAttribute("font-weight")).toBe("600");
  expect(
    Number(named.querySelector("tspan:last-child")?.getAttribute("font-size")) *
      0.5,
  ).toBe(12);
  expect(Number(unnamed.getAttribute("font-size")) * 0.5).toBe(12);
  expect(named.getAttribute("font-weight")).toBe("400");
  expect(unnamed.getAttribute("font-weight")).toBe("400");
  const dimension = container.querySelector('[data-layer="dimensions"] text');
  expect(dimension?.parentElement?.getAttribute("transform")).toMatch(
    / scale\(2\)$/,
  );
  expect(dimension?.getAttribute("font-size")).toBe("12");
});

it.each([
  40, 110,
])("fits fixed-size room text and an ellipsis inside a %icm left wall", (leftThickness) => {
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
  const [, x] = /^translate\(([^ ]+) ([^)]+)\)$/.exec(outline)!;
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
  expect(label.getAttribute("font-size")).toBe("28");
  expect(label.textContent).toContain("…");
  expect(group.querySelector("title")?.textContent).toBe(name);
  expect(label.querySelector("tspan:last-child")?.textContent).toBe("3.12 m²");
  for (const line of label.querySelectorAll("tspan")) {
    const halfWidth = measureText(line.textContent ?? "").width / 2 + 1.5;
    expect(Number(x) - halfWidth).toBeGreaterThan(leftInnerEdge);
    expect(Number(x) + halfWidth).toBeLessThan(rightInnerEdge);
  }
  expect(useApp.getState().plan.roomNames).toEqual([{ anchor, name }]);
});

it.each([
  {
    width: 180,
    height: 90,
    thickness: 12,
    scale: 1,
    name: "Ground floor coat and linen storage",
    area: "1.62 m²",
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
])("renders $name and retains eligible dimensions at $scale×", ({
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
      /translate\(([^ ]+) ([^)]+)\)(?: rotate\(([^)]+)\))?(?: scale\(([^)]+)\))?/.exec(
        transform,
      )!;
    const radians = (Number(rotation ?? 0) * Math.PI) / 180;
    const cos = Math.cos(radians);
    const sin = Math.sin(radians);
    const halo = 1.5;
    const halfWidth = measureText(line.textContent ?? "").width / 2 + halo;
    const baseline = Number(line.getAttribute("y"));
    const halfHeight =
      Number(
        line.getAttribute("font-size") ??
          line.parentElement!.getAttribute("font-size"),
      ) / 2;
    const top = baseline - (alphaBaseline ? 8 : halfHeight) - halo;
    const bottom = baseline + (alphaBaseline ? 2 : halfHeight) + halo;
    const corners = [
      [-halfWidth, top],
      [halfWidth, top],
      [halfWidth, bottom],
      [-halfWidth, bottom],
    ].map(([u, v]) => ({
      x: Number(x) + (u * cos - v * sin) * Number(factor ?? 1),
      y: Number(y) + (u * sin + v * cos) * Number(factor ?? 1),
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
  if (scale === 0.5) {
    const before = dimensions.map((line) => line.parentElement?.outerHTML);
    act(() => store.loadPlan({ ...useApp.getState().plan, roomNames: [] }));
    expect(
      [...container.querySelectorAll('[data-layer="dimensions"] text')].map(
        (line) => line.parentElement?.outerHTML,
      ),
    ).toEqual(before);
    return;
  }
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

it.each([
  {
    name: "Bathroom",
    width: 165,
    height: 240,
    hingeY: 102,
    area: "3.96 m²",
    betweenDoorMarks: false,
  },
  {
    name: "WC",
    width: 120,
    height: 140,
    hingeY: 115,
    area: "1.68 m²",
    betweenDoorMarks: true,
  },
])("keeps the full $name label clear of the rendered door swing in the editor and SVG", ({
  name,
  width,
  height,
  hingeY,
  area,
  betweenDoorMarks,
}) => {
  // Use the same deterministic width for both renderers in compact geometry.
  const textWidth = (text: string, fontSize: number) =>
    text.length * (betweenDoorMarks ? 6 : fontSize * 0.6);
  vi.stubGlobal("CanvasRenderingContext2D", function CanvasContext() {});
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
    () =>
      ({
        font: "",
        measureText(text: string) {
          const fontSize = Number(this.font.match(/(\d+)px/)?.[1]);
          return { width: textWidth(text, fontSize) };
        },
      }) as CanvasRenderingContext2D,
  );
  const plan = roomPlan();
  const resize = ({ x, y }: { x: number; y: number }) => ({
    x: (x * width) / 400,
    y: (y * height) / 300,
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
      wallAttach: { wallId: "w3", offset: height - hingeY, length: 90 },
      thickness: 20,
      props: { hingeEdge: "start", swingSide: "inside" },
    },
  ];
  plan.roomNames = [{ anchor: { x: width / 2, y: height / 2 }, name }];
  const store = useApp.getState();
  store.loadPlan(plan);
  store.setView(() => DEFAULT_VIEW);

  const { container } = render(<FloorPlan />);
  const svg = new DOMParser().parseFromString(
    buildExportSvg(plan, undefined, (text, _weight, fontSize) =>
      textWidth(text, fontSize),
    ).markup,
    "image/svg+xml",
  );
  const verify = (root: ParentNode, label: Element, rows: string) => {
    const door = root.querySelector('[data-layer="items"]')!;
    expect(door.querySelector("path")?.getAttribute("d")).toBe(
      `M 0 ${hingeY - 90} A 90 90 0 0 1 90 ${hingeY}`,
    );
    const leaf = door.querySelector("line")!;
    expect(
      ["x1", "y1", "x2", "y2"].map((attr) => leaf.getAttribute(attr)),
    ).toEqual(["0", String(hingeY), "90", String(hingeY)]);
    const hinge = door.querySelector("circle")!;
    const hingeRadius = Number(hinge.getAttribute("r"));
    const [, labelX, labelY] = /^translate\(([^ ]+) ([^)]+)\)$/.exec(
      label.getAttribute("transform")!,
    )!;
    const lines = [...label.querySelectorAll(rows)];
    expect(lines.map((row) => row.textContent)).toEqual([name, area]);
    for (const line of lines) {
      const fontSize = Number(
        line.getAttribute("font-size") ?? label.getAttribute("font-size"),
      );
      const glyphHalfHeight =
        (fontSize + Number(label.getAttribute("stroke-width"))) / 2;
      const top =
        Number(labelY) + Number(line.getAttribute("y")) - glyphHalfHeight;
      const halfWidth = textWidth(line.textContent ?? "", fontSize) / 2 + 1.5;
      const left = Number(labelX) - halfWidth;
      if (betweenDoorMarks) {
        const bottom = top + 2 * glyphHalfHeight;
        const right = Number(labelX) + halfWidth;
        expect(left).toBeGreaterThan(6);
        expect(top).toBeGreaterThan(hingeY - 90);
        // The upper-right corner is farthest from the hinge here. Keep the
        // entire text box above the leaf and inside the arc's inner edge.
        expect(Math.hypot(right, top - hingeY)).toBeLessThan(89.5);
        expect(bottom).toBeLessThan(hingeY - 0.5);
      } else {
        expect(top).toBeGreaterThan(hingeY + 0.5);
        expect(top > hingeY + hingeRadius || left > hingeRadius).toBe(true);
      }
    }
  };
  verify(
    container,
    container.querySelector('[data-layer="rooms"] text')!,
    "tspan",
  );
  verify(svg, svg.querySelector('[data-layer="room-areas"] > g')!, "text");
  expect(
    container
      .querySelector('[data-layer="rooms"] text')
      ?.getAttribute("transform"),
  ).toBe(
    svg
      .querySelector('[data-layer="room-areas"] > g')
      ?.getAttribute("transform"),
  );
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
      .map((label) => {
        const rows = [...label.querySelectorAll("tspan")].map(
          (row) => row.textContent,
        );
        return rows.length
          ? rows.slice(0, -1).join(" ") + rows.at(-1)
          : label.textContent;
      })
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
