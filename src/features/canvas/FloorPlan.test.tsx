// @vitest-environment jsdom
import { parsePlan, serializePlan } from "@app/io";
import { loadPersistedHistory } from "@app/persistence";
import { MAX_ROOM_NAME_LENGTH } from "@app/roomName";
import { createInitialPlan, type Plan, type Wall } from "@app/schema";
import type { Tool } from "@app/store";
import { useApp } from "@app/store";
import { DEFAULT_VIEW, MIN_SCALE } from "@app/viewport";
import { MeasurementSystemSwitch } from "@features/toolbar/MeasurementSystemSwitch";
import { Toolbar } from "@features/toolbar/Toolbar";
import { getPlanBounds } from "@geometry/bounds";
import { buildExportSvg } from "@geometry/exportSvg";
import { detectRooms, findRoomAt } from "@geometry/rooms";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FloorPlan } from "./FloorPlan";

const wall = (
  ax: number,
  ay: number,
  bx: number,
  by: number,
  id: string,
): Wall => ({ id, a: { x: ax, y: ay }, b: { x: bx, y: by }, thickness: 10 });

/** Two walls sharing a corner — real geometry to drag, not a lone wall. */
const cornerPlan = (): Plan => ({
  ...createInitialPlan(),
  walls: [wall(0, 0, 400, 0, "w1"), wall(400, 0, 400, 300, "w2")],
});

const enclosedPlan = (): Plan => {
  const plan = cornerPlan();
  return {
    ...plan,
    walls: [
      ...plan.walls,
      wall(400, 300, 0, 300, "w3"),
      wall(0, 300, 0, 0, "w4"),
    ],
  };
};

/**
 * jsdom implements neither `PointerEvent` nor pointer capture, so synthesize the
 * parts the canvas actually reads: a bubbling MouseEvent carrying a `pointerId`.
 * React dispatches it to `onPointerDown`/`Move`/`Up`/`Cancel` by type.
 *
 * Note it carries no usable `movementX`/`movementY` — which is exactly the touch
 * situation, since browsers only populate those for mouse pointers.
 */
function pointerEvent(
  type: "pointerdown" | "pointermove" | "pointerup" | "pointercancel",
  id: number,
  x: number,
  y: number,
  init: { button?: number; buttons?: number; pointerType?: string } = {},
): Event {
  const event = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX: x,
    clientY: y,
    button: init.button ?? 0,
    buttons: init.buttons ?? (type === "pointerup" ? 0 : 1),
  });
  Object.defineProperty(event, "pointerId", { value: id });
  Object.defineProperty(event, "pointerType", {
    value: init.pointerType ?? "touch",
  });
  return event;
}

const view = () => useApp.getState().view;
const walls = () => useApp.getState().plan.walls;

describe("FloorPlan touch gestures", () => {
  let canvas: SVGSVGElement;

  /**
   * Put the store in a known state and render the canvas. The store is set
   * *before* rendering so the component's first render already sees the tool and
   * plan under test (a store write after render would need its own `act`).
   */
  const setup = (options: { tool?: Tool; plan?: Plan } = {}) => {
    useApp.getState().loadPlan(options.plan ?? createInitialPlan());
    useApp.getState().setTool(options.tool ?? "wall");
    useApp.getState().setView(() => DEFAULT_VIEW);
    const svg = render(<FloorPlan />).container.querySelector("svg");
    if (!svg) throw new Error("no canvas rendered");
    canvas = svg as SVGSVGElement;
  };

  /** press / drag / lift / cancel a single contact by id, in client pixels. */
  const down = (
    id: number,
    x: number,
    y: number,
    init?: { button?: number; buttons?: number; pointerType?: string },
  ) => fireEvent(canvas, pointerEvent("pointerdown", id, x, y, init));
  const move = (
    id: number,
    x: number,
    y: number,
    init?: { button?: number; buttons?: number },
  ) => fireEvent(canvas, pointerEvent("pointermove", id, x, y, init));
  const up = (id: number, x: number, y: number) =>
    fireEvent(canvas, pointerEvent("pointerup", id, x, y));
  const cancel = (id: number, x: number, y: number) =>
    fireEvent(canvas, pointerEvent("pointercancel", id, x, y));

  beforeEach(() => {
    // jsdom has no pointer capture; the canvas takes it on every pointerdown.
    for (const name of [
      "setPointerCapture",
      "releasePointerCapture",
    ] as const) {
      Object.defineProperty(Element.prototype, name, {
        value: () => {},
        configurable: true,
        writable: true,
      });
    }
    Object.defineProperty(Element.prototype, "hasPointerCapture", {
      value: () => true,
      configurable: true,
      writable: true,
    });
  });

  afterEach(() => {
    cleanup();
    for (const name of [
      "setPointerCapture",
      "releasePointerCapture",
      "hasPointerCapture",
    ]) {
      Reflect.deleteProperty(Element.prototype, name);
    }
    localStorage.clear();
  });

  it("can cancel a wall drag after another contact switches the toolbar's units", () => {
    setup({ tool: "select", plan: cornerPlan() });
    render(<MeasurementSystemSwitch />);
    const original = walls();
    down(1, 200, 0);
    move(1, 240, 40);
    const preview = walls();
    expect(preview).not.toEqual(original);
    const imperial = screen.getByRole("button", { name: "Imperial" });
    fireEvent(imperial, pointerEvent("pointerdown", 2, 0, 0));
    fireEvent(imperial, pointerEvent("pointerup", 2, 0, 0));
    fireEvent.click(imperial);
    expect(walls()).toEqual(preview);
    cancel(1, 240, 40);
    expect(walls()).toEqual(original);
    expect(useApp.getState().plan.meta.measurementSystem).toBe("imperial");
    act(() => useApp.getState().undo());
    expect(walls()).toEqual(original);
    expect(useApp.getState().plan.meta.measurementSystem).toBe("metric");
  });

  it("uses the toolbar to label three areas of one room and the terrace independently", () => {
    setup({ plan: enclosedPlan() });
    render(<Toolbar />);
    const rooms = detectRooms(walls());
    expect(rooms.map((room) => room.area)).toEqual([120000]);
    const labels = () => useApp.getState().plan.labels;
    const input = () => screen.getByRole("textbox", { name: "Label text" });
    const labelGraphics = () => [
      ...canvas.querySelectorAll('[data-layer="plan-labels"] text'),
    ];
    const selectTool = (name: string) =>
      fireEvent.click(screen.getByRole("button", { name }));
    // The test uses client positions, so the result also checks the inverse view transform.
    act(() =>
      useApp.getState().setView(() => ({ scale: 2, panX: 20, panY: 40 })),
    );
    const tap = (x: number, y: number, pointerType = "touch") => {
      down(1, x, y, { pointerType });
      up(1, x, y);
    };

    selectTool("Label");
    for (const [text, x, y] of [
      ["Kitchen", 100, 80],
      ["Dining", 220, 240],
      ["Living", 70, 180],
      ["Terrace & 茶室 <🌿>", 555.5, 330],
    ] as const) {
      tap(x * 2 + 20, y * 2 + 40);
      expect(document.activeElement).toBe(input());
      fireEvent.change(input(), { target: { value: text } });
      fireEvent.click(screen.getByRole("button", { name: "Save" }));
      expect(labels()?.at(-1)).toMatchObject({ text, position: { x, y } });
    }
    const original = labels();
    expect(
      original?.map(({ position }) => findRoomAt(rooms, position)?.area),
    ).toEqual([120000, 120000, 120000, undefined]);
    expect(labelGraphics().map((label) => label.textContent)).toEqual(
      original?.map((label) => label.text),
    );

    selectTool("Select");
    down(1, 1131, 700, { pointerType: "mouse" });
    move(1, 1171, 720);
    expect(
      labelGraphics().at(-1)?.parentElement?.getAttribute("transform"),
    ).toBe("translate(575.5 340)");
    expect(labels()).toEqual(original);
    up(1, 1181, 730);
    expect(labels()?.at(-1)?.position).toEqual({ x: 580.5, y: 345 });
    selectTool("Undo");
    expect(labels()).toEqual(original);
    selectTool("Redo");
    expect(labels()?.at(-1)?.position).toEqual({ x: 580.5, y: 345 });

    tap(1181, 730);
    for (const key of ["Backspace", "ArrowLeft", "[", "h", "s"]) {
      expect(fireEvent.keyDown(input(), { key })).toBe(true);
    }
    expect(fireEvent.keyDown(input(), { key: "z", ctrlKey: true })).toBe(true);
    expect(labels()?.at(-1)?.text).toBe("Terrace & 茶室 <🌿>");
    fireEvent.change(input(), { target: { value: "Terrace & Patio <🌿>" } });
    fireEvent.submit(input().closest("form")!);
    const edited = labels();
    expect(edited?.at(-1)?.text).toBe("Terrace & Patio <🌿>");
    expect(loadPersistedHistory()?.present.labels).toEqual(edited);
    expect(parsePlan(serializePlan(useApp.getState().plan)).labels).toEqual(
      edited,
    );

    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    expect(labelGraphics()).toHaveLength(3);
    selectTool("Undo");
    expect(labels()).toEqual(edited);
    tap(220, 200);
    fireEvent.keyDown(window, { key: "Delete" });
    expect(labelGraphics().map((label) => label.textContent)).toEqual([
      "Dining",
      "Living",
      "Terrace & Patio <🌿>",
    ]);
    expect(detectRooms(walls())).toEqual(rooms);
  });

  it("abandons a placement or label drag when touch becomes a pinch", () => {
    const label = {
      id: "terrace",
      text: "Terrace",
      position: { x: 500, y: 350 },
    };
    setup({ plan: { ...enclosedPlan(), labels: [label] }, tool: "label" });
    down(1, 500, 350);
    down(2, 550, 350);
    up(2, 550, 350);
    up(1, 500, 350);
    expect(screen.queryByRole("textbox", { name: "Label text" })).toBeNull();

    act(() => useApp.getState().setTool("select"));
    down(1, 500, 350);
    move(1, 540, 370);
    down(2, 550, 350);
    up(2, 550, 350);
    up(1, 540, 370);
    expect(useApp.getState().plan.labels).toEqual([label]);
    expect(
      canvas
        .querySelector('[data-layer="plan-labels"] > g')
        ?.getAttribute("transform"),
    ).toBe("translate(500 350)");
    expect(loadPersistedHistory()?.past).toHaveLength(0);
  });

  it("fits a distant outdoor label and returns to that zoom with wheel and pinch", () => {
    const plan = {
      ...enclosedPlan(),
      labels: [
        {
          id: "terrace",
          text: "Outdoor Terrace",
          position: { x: 9500, y: -400 },
        },
      ],
    };
    setup({ plan });
    render(<Toolbar />);
    act(() => useApp.getState().setCanvasSize({ width: 800, height: 600 }));
    fireEvent.click(screen.getByRole("button", { name: "Fit" }));
    const { scale, panX, panY } = view();
    const bounds = getPlanBounds(plan)!;
    expect(scale).toBeLessThan(MIN_SCALE);
    expect(bounds.minX * scale + panX).toBeGreaterThan(0);
    expect(bounds.minY * scale + panY).toBeGreaterThan(0);
    expect(bounds.maxX * scale + panX).toBeLessThan(800);
    expect(bounds.maxY * scale + panY).toBeLessThan(600);

    fireEvent.wheel(canvas, { deltaY: -250, clientX: 400, clientY: 300 });
    expect(view().scale).toBeGreaterThan(scale);
    fireEvent.wheel(canvas, { deltaY: 250, clientX: 400, clientY: 300 });
    expect(view().scale).toBeCloseTo(scale, 8);
    expect(view().panX).toBeCloseTo(panX);
    expect(view().panY).toBeCloseTo(panY);

    down(1, 200, 300);
    down(2, 600, 300);
    move(2, 700, 300);
    up(2, 700, 300);
    up(1, 200, 300);
    expect(view().scale).toBeGreaterThan(scale);

    down(1, 200, 300);
    down(2, 700, 300);
    move(2, 600, 300);
    up(2, 600, 300);
    up(1, 200, 300);
    expect(view().scale).toBeCloseTo(scale, 8);
    expect(view().panX).toBeCloseTo(panX);
    expect(view().panY).toBeCloseTo(panY);
  });

  describe("one finger runs the active tool's gesture", () => {
    it("draws a wall, as one undo step", () => {
      setup({ tool: "wall" });

      down(1, 100, 100);
      move(1, 300, 100);
      up(1, 300, 100);

      expect(walls()).toHaveLength(1);
      expect(walls()[0].a).toEqual({ x: 100, y: 100 });
      expect(walls()[0].b).toEqual({ x: 300, y: 100 });

      useApp.getState().undo();
      expect(walls()).toHaveLength(0);
    });

    it("pans with the Pan tool active", () => {
      setup({ tool: "pan" });

      down(1, 100, 100);
      move(1, 140, 190);
      up(1, 140, 190);

      expect(view().panX).toBeCloseTo(40);
      expect(view().panY).toBeCloseTo(90);
      expect(view().scale).toBe(DEFAULT_VIEW.scale);
    });

    it("selects a room interior, saves a name, and keeps marquee selection available", () => {
      setup({ tool: "select", plan: enclosedPlan() });
      const room = () => canvas.querySelector('[data-layer="rooms"]');
      expect(room()?.textContent).toBe("12 m²");

      down(1, 260, 180);
      up(1, 261, 180);
      const name = "Cuisine & 茶室 <🏠>";
      fireEvent.change(screen.getByRole("textbox", { name: "Room name" }), {
        target: { value: name },
      });
      fireEvent.click(screen.getByRole("button", { name: "Save" }));
      expect(room()?.textContent).toBe(`${name}12 m²`);
      expect(loadPersistedHistory()?.present.roomNames).toEqual([
        { anchor: { x: 200, y: 150 }, name },
      ]);

      down(1, 200, 150);
      move(1, 450, 350);
      up(1, 450, 350);
      expect(screen.queryByRole("textbox", { name: "Room name" })).toBeNull();
      expect(useApp.getState().selectedWalls).toEqual(new Set(["w2", "w3"]));
    });

    it("can choose, rename and clear a room from the keyboard with undo and redo", () => {
      setup({ tool: "select", plan: enclosedPlan() });
      const oldName = "Dining room";
      const newName = "Study";
      const label = screen.getByRole("button", { name: "Room, 12 m²" });
      const focusOutline = () =>
        canvas.querySelector('[data-layer="room-focus"] polygon');
      act(() => label.focus());
      expect(focusOutline()?.getAttribute("points")).toBe(
        label.querySelector("polygon")?.getAttribute("points"),
      );
      expect(label.getAttribute("aria-pressed")).toBe("false");
      expect(screen.queryByRole("textbox", { name: "Room name" })).toBeNull();

      fireEvent.keyDown(label, { key: "Enter" });
      const input = screen.getByRole<HTMLInputElement>("textbox", {
        name: "Room name",
      });
      expect(document.activeElement).toBe(input);
      expect(focusOutline()).toBeNull();
      expect(label.getAttribute("aria-pressed")).toBe("true");

      const save = (value: string) => {
        fireEvent.change(input, { target: { value } });
        fireEvent.submit(input.closest("form")!);
      };
      save(oldName);
      expect(screen.getByRole("button", { name: `${oldName}, 12 m²` })).toBe(
        label,
      );
      save(newName);
      expect(screen.getByRole("button", { name: `${newName}, 12 m²` })).toBe(
        label,
      );

      const clear = screen.getByRole("button", { name: "Clear" });
      clear.focus();
      fireEvent.click(clear);
      expect(document.activeElement).toBe(input);
      expect(label.getAttribute("aria-label")).toBe("Room, 12 m²");
      expect(input.value).toBe("");

      for (const value of [newName, oldName, ""]) {
        act(() => useApp.getState().undo());
        expect(label.getAttribute("aria-label")).toBe(
          `${value || "Room"}, 12 m²`,
        );
        expect(input.value).toBe(value);
      }
      for (const value of [oldName, newName, ""]) {
        act(() => useApp.getState().redo());
        expect(label.getAttribute("aria-label")).toBe(
          `${value || "Room"}, 12 m²`,
        );
        expect(input.value).toBe(value);
      }
    });

    it("names the surrounding and nested rooms separately by pointer and keyboard", () => {
      const plan = createInitialPlan();
      plan.walls = [
        wall(0, 0, 600, 0, "o1"),
        wall(600, 0, 600, 480, "o2"),
        wall(600, 480, 0, 480, "o3"),
        wall(0, 480, 0, 0, "o4"),
        wall(100, 80, 500, 80, "i1"),
        wall(500, 80, 500, 400, "i2"),
        wall(500, 400, 100, 400, "i3"),
        wall(100, 400, 100, 80, "i4"),
      ];
      setup({ tool: "select", plan });
      const outer = screen.getByRole("button", { name: "Room, 28.8 m²" });
      const inner = screen.getByRole("button", { name: "Room, 12.8 m²" });
      expect(outer.querySelector("text")?.getAttribute("transform")).not.toBe(
        inner.querySelector("text")?.getAttribute("transform"),
      );
      const input = () =>
        screen.getByRole<HTMLInputElement>("textbox", { name: "Room name" });
      const save = (value: string) => {
        fireEvent.change(input(), { target: { value } });
        fireEvent.submit(input().closest("form")!);
      };

      down(1, 50, 240);
      up(1, 50, 240);
      expect(outer.getAttribute("aria-pressed")).toBe("true");
      expect(inner.getAttribute("aria-pressed")).toBe("false");
      save("Hall");

      fireEvent.keyDown(inner, { key: "Enter" });
      expect(input().value).toBe("");
      save("Study");
      const persisted = loadPersistedHistory()!.present;
      const imported = parsePlan(serializePlan(persisted));
      const rooms = detectRooms(imported.walls);
      expect(
        imported.roomNames?.map(({ anchor, name }) => [
          name,
          findRoomAt(rooms, anchor)?.area,
        ]),
      ).toEqual([
        ["Hall", 288000],
        ["Study", 128000],
      ]);
      act(() => useApp.getState().loadPlan(imported));
      fireEvent.keyDown(screen.getByRole("button", { name: "Hall, 28.8 m²" }), {
        key: "Enter",
      });
      expect(input().value).toBe("Hall");

      const svg = new DOMParser().parseFromString(
        buildExportSvg(imported).markup,
        "image/svg+xml",
      );
      const labels = [...svg.querySelectorAll('[data-layer="room-areas"] > g')];
      expect(
        labels.map(
          (label) =>
            label.querySelector('text[font-weight="600"]')?.textContent,
        ),
      ).toEqual(["Hall", "Study"]);
      expect(
        new Set(labels.map((label) => label.getAttribute("transform"))).size,
      ).toBe(2);
    });

    it("limits room name edits and preserves an existing long imported name", () => {
      const plan = enclosedPlan();
      const importedName = "A".repeat(6000);
      const anchor = { x: 200, y: 150 };
      plan.roomNames = [{ anchor, name: importedName }];
      setup({ tool: "select", plan: parsePlan(serializePlan(plan)) });
      down(1, anchor.x, anchor.y);
      up(1, anchor.x, anchor.y);

      const input = screen.getByRole<HTMLInputElement>("textbox", {
        name: "Room name",
      });
      const save = screen.getByRole<HTMLButtonElement>("button", {
        name: "Save",
      });
      expect(input.value).toBe(importedName);
      expect(screen.queryByRole("alert")).toBeNull();

      const allowed = "🧑🏽‍🔧".repeat(MAX_ROOM_NAME_LENGTH);
      const tooLong = `${allowed}&`;
      fireEvent.change(input, { target: { value: tooLong } });
      expect(input.getAttribute("aria-invalid")).toBe("true");
      expect(screen.getByRole("alert").textContent).toContain(
        `up to ${MAX_ROOM_NAME_LENGTH} characters`,
      );
      expect(save.disabled).toBe(true);
      fireEvent.submit(input.closest("form")!);
      act(() => useApp.getState().setSelectedRoomName(tooLong));
      expect(useApp.getState().plan.roomNames).toEqual([
        { anchor, name: importedName },
      ]);

      fireEvent.change(input, { target: { value: allowed } });
      expect(screen.queryByRole("alert")).toBeNull();
      expect(save.disabled).toBe(false);
      fireEvent.click(save);
      expect(useApp.getState().plan.roomNames).toEqual([
        { anchor, name: allowed },
      ]);
      act(() => useApp.getState().undo());
      expect(input.value).toBe(importedName);
    });
  });

  describe("two fingers pan and zoom, whatever the tool", () => {
    it("pans on a two-finger drag with the Wall tool active", () => {
      setup({ tool: "wall" });

      down(1, 200, 200);
      down(2, 400, 200);
      move(1, 250, 230);
      move(2, 450, 230);
      up(1, 250, 230);
      up(2, 450, 230);

      expect(view().panX).toBeCloseTo(50);
      expect(view().panY).toBeCloseTo(30);
      // A pan is a viewport change only: no zoom, no wall drawn.
      expect(view().scale).toBeCloseTo(DEFAULT_VIEW.scale);
      expect(walls()).toHaveLength(0);
    });

    it("zooms about the finger midpoint on a pinch", () => {
      setup({ tool: "select" });

      down(1, 300, 400);
      down(2, 500, 400);
      // Spread symmetrically about (400, 400): distance 200 → 400.
      move(1, 200, 400);
      move(2, 600, 400);

      expect(view().scale).toBeCloseTo(2);
      // The world point under the midpoint stayed under it.
      expect((400 - view().panX) / view().scale).toBeCloseTo(400);
      expect((400 - view().panY) / view().scale).toBeCloseTo(400);

      up(1, 200, 400);
      up(2, 600, 400);
    });

    it("pans and zooms together in one gesture", () => {
      setup({ tool: "select" });

      down(1, 300, 400);
      down(2, 500, 400);
      // Midpoint slides to (500, 340) while the distance grows 200 → 300.
      move(1, 350, 340);
      move(2, 650, 340);

      expect(view().scale).toBeCloseTo(1.5);
      // The world point that was under (400, 400) is now under (500, 340).
      expect((500 - view().panX) / view().scale).toBeCloseTo(400);
      expect((340 - view().panY) / view().scale).toBeCloseTo(400);
    });

    it("abandons an in-progress wall draft instead of committing it", () => {
      setup({ tool: "wall" });

      down(1, 100, 100);
      move(1, 300, 100); // a wall drag is now in flight
      down(2, 500, 400); // ...and a second finger takes over

      up(1, 300, 100);
      up(2, 500, 400);

      expect(walls()).toHaveLength(0);
    });

    it("leaves the wall selected, not the junction, when it abandons a wall drag", () => {
      const plan = cornerPlan();
      setup({ tool: "select", plan });

      // Select the junction the two walls share, then grab w1's body — that
      // selects the wall, which deselects the junction.
      down(1, 400, 0);
      up(1, 400, 0);
      expect(useApp.getState().selectedConnectionPoint).toEqual({
        x: 400,
        y: 0,
      });

      down(1, 100, 0);
      move(1, 100, 60); // live preview: w1 slides 60cm down
      down(2, 500, 400); // ...and a second finger abandons the drag

      // Regression: rolling the drag back used to restore the junction
      // selection the wall grab had replaced, so the arrow keys moved the
      // junction while the highlighted wall stayed put.
      expect(useApp.getState().selectedConnectionPoint).toBeNull();
      fireEvent.keyDown(window, { key: "ArrowRight" });
      // The whole wall moved one grid step, dragging w2's shared end along.
      expect(walls()[0].a).toEqual({ x: 20, y: 0 });
      expect(walls()[0].b).toEqual({ x: 420, y: 0 });
      expect(walls()[1].a).toEqual({ x: 420, y: 0 });
      expect(walls()[1].b).toEqual({ x: 400, y: 300 });
    });

    it("leaves a leftover finger unable to draw after the pinch", () => {
      setup({ tool: "wall" });

      down(1, 200, 200);
      down(2, 400, 200);
      up(2, 400, 200); // one finger stays down
      move(1, 300, 300);
      up(1, 300, 300);

      expect(walls()).toHaveLength(0);
    });
  });

  describe("pointercancel does not leave the canvas stuck", () => {
    it("drops a wall draft without committing it", () => {
      setup({ tool: "wall" });

      down(1, 100, 100);
      move(1, 300, 100);
      cancel(1, 300, 100);

      expect(walls()).toHaveLength(0);

      // The abandoned draft doesn't chain into the next gesture either: the
      // following tap starts a fresh wall rather than closing the old one.
      down(1, 200, 200);
      up(1, 200, 200);
      expect(walls()).toHaveLength(0);
    });

    it("rolls back a live wall drag, adding no undo entry", () => {
      const plan = cornerPlan();
      setup({ tool: "select", plan });

      down(1, 100, 0); // grabs w1, which runs along y = 0
      move(1, 100, 60); // live preview: w1 slides 60cm down
      expect(walls()[0].a.y).toBeCloseTo(60);

      cancel(1, 100, 60);

      // Back where it started, with no history entry to undo.
      expect(useApp.getState().plan).toEqual(plan);
      expect(useApp.getState().liveDragItems).toBeNull();
      useApp.getState().undo();
      expect(useApp.getState().plan).toEqual(plan);
    });
  });

  describe("mouse behavior is unchanged", () => {
    it("still pans on a right-drag", () => {
      setup({ tool: "select" });

      down(1, 100, 100, { button: 2, buttons: 2 });
      move(1, 150, 120, { button: 2, buttons: 2 });
      up(1, 150, 120);

      expect(view().panX).toBeCloseTo(50);
      expect(view().panY).toBeCloseTo(20);
      expect(useApp.getState().isPanning).toBe(false);
    });

    it("still drags a wall and commits it as one undo step", () => {
      setup({ tool: "select", plan: cornerPlan() });

      down(1, 100, 0);
      move(1, 100, 60);
      up(1, 100, 60);

      expect(walls()[0].a.y).toBeCloseTo(60);
      useApp.getState().undo();
      expect(walls()[0].a.y).toBeCloseTo(0);
    });
  });
});
