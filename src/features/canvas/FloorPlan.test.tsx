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
import { WallOptionsBar } from "@features/toolbar/wall/WallOptionsBar";
import { getPlanBounds } from "@geometry/bounds";
import { buildExportSvg } from "@geometry/exportSvg";
import { getFixtureBounds } from "@geometry/fixtures";
import { planLabelRect } from "@geometry/planLabels";
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
  init: {
    button?: number;
    buttons?: number;
    pointerType?: string;
    shiftKey?: boolean;
  } = {},
): Event {
  const event = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX: x,
    clientY: y,
    button: init.button ?? 0,
    buttons: init.buttons ?? (type === "pointerup" ? 0 : 1),
    shiftKey: init.shiftKey,
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
    init?: Parameters<typeof pointerEvent>[4],
  ) => fireEvent(canvas, pointerEvent("pointerdown", id, x, y, init));
  const move = (
    id: number,
    x: number,
    y: number,
    init?: { button?: number; buttons?: number; pointerType?: string },
  ) => fireEvent(canvas, pointerEvent("pointermove", id, x, y, init));
  const up = (id: number, x: number, y: number, pointerType?: string) =>
    fireEvent(canvas, pointerEvent("pointerup", id, x, y, { pointerType }));
  const cancel = (id: number, x: number, y: number) =>
    fireEvent(canvas, pointerEvent("pointercancel", id, x, y));
  const fixturePreview = () => canvas.querySelector("[data-fixture-preview]");

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
      fireEvent.keyDown(input(), { key: "Enter" });
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
    expect(loadPersistedHistory()?.present.labels).toEqual(original);
    up(1, 1181, 730);
    expect(labels()?.at(-1)?.position).toEqual({ x: 580.5, y: 345 });
    selectTool("Undo");
    expect(labels()).toEqual(original);
    selectTool("Redo");
    expect(labels()?.at(-1)?.position).toEqual({ x: 580.5, y: 345 });

    tap(1181, 730);
    expect(screen.queryByRole("textbox", { name: "Label text" })).toBeNull();
    tap(1181, 730);
    expect(input()).toBe(document.activeElement);
    expect(labelGraphics()).toHaveLength(3);
    for (const key of ["Backspace", "ArrowLeft", "[", "h", "s"]) {
      expect(fireEvent.keyDown(input(), { key })).toBe(true);
    }
    expect(fireEvent.keyDown(input(), { key: "z", ctrlKey: true })).toBe(true);
    expect(labels()?.at(-1)?.text).toBe("Terrace & 茶室 <🌿>");
    fireEvent.change(input(), { target: { value: "Terrace & Patio <🌿>" } });
    fireEvent.keyDown(input(), { key: "Enter" });
    const edited = labels();
    expect(edited?.at(-1)?.text).toBe("Terrace & Patio <🌿>");
    expect(loadPersistedHistory()?.present.labels).toEqual(edited);
    expect(parsePlan(serializePlan(useApp.getState().plan)).labels).toEqual(
      edited,
    );

    tap(1181, 730);
    fireEvent.change(input(), { target: { value: "" } });
    tap(1300, 800);
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

  it("starts with an empty caret at the placement point and commits inline text on click-away", () => {
    setup({ tool: "label", plan: enclosedPlan() });
    act(() =>
      useApp.getState().setView(() => ({ ...DEFAULT_VIEW, scale: 0.25 })),
    );
    const graphic = () =>
      canvas.querySelector('[data-layer="plan-labels"] text');
    const draftGraphic = () =>
      canvas.querySelector('[data-layer="label-edit-preview"] text');
    const place = (x = 150) => {
      down(1, x, 100);
      up(1, x, 100);
      return screen.getByRole<HTMLInputElement>("textbox", {
        name: "Label text",
      });
    };
    const field = place();
    expect(field.value).toBe("");
    expect(document.activeElement).toBe(field);
    expect([field.selectionStart, field.selectionEnd]).toEqual([0, 0]);
    expect(field.style.left).toBe("150px");
    expect(Number.parseFloat(field.style.top)).toBeCloseTo(93.525);
    expect(field.style.fontSize).toBe("7px");
    expect(field.style.fontWeight).toBe("600");
    expect(graphic()).toBeNull();
    fireEvent.change(field, { target: { value: "Terrace" } });
    expect(field.value).toBe("Terrace");
    expect(draftGraphic()?.textContent).toBe("Terrace");
    expect(draftGraphic()?.getAttribute("text-anchor")).toBe("start");
    expect(draftGraphic()?.parentElement?.getAttribute("transform")).toBe(
      "translate(600 400)",
    );
    fireEvent.keyDown(field, { key: "Enter", isComposing: true });
    expect(useApp.getState().plan.labels).toBeUndefined();

    fireEvent.keyDown(field, { key: "Escape" });
    expect(graphic()).toBeNull();
    expect(screen.queryByRole("textbox", { name: "Label text" })).toBeNull();
    expect(loadPersistedHistory()?.past).toHaveLength(0);

    const placed = place();
    fireEvent.change(placed, { target: { value: "T" } });
    const draftPosition =
      draftGraphic()?.parentElement?.getAttribute("transform");
    fireEvent.change(placed, { target: { value: "Terrace  & 茶室" } });
    const draft = draftGraphic()?.outerHTML;
    expect(draftGraphic()?.parentElement?.getAttribute("transform")).toBe(
      draftPosition,
    );
    fireEvent.keyDown(placed, { key: "Enter" });
    expect(graphic()?.outerHTML).toBe(draft);
    expect(graphic()?.parentElement?.getAttribute("transform")).toBe(
      draftPosition,
    );
    act(() => useApp.getState().undo());

    fireEvent.change(place(), { target: { value: "Terrace" } });
    const next = place(250);
    expect(next.value).toBe("");
    expect(document.activeElement).toBe(next);
    expect(graphic()?.textContent).toBe("Terrace");
    expect(useApp.getState().plan.labels?.[0]).toMatchObject({
      position: { x: 600, y: 400 },
      text: "Terrace",
    });
    fireEvent.blur(next);
    expect(loadPersistedHistory()?.past).toHaveLength(1);
    expect(Number(graphic()?.getAttribute("font-size")) * view().scale).toBe(7);
    const anchor = graphic()?.parentElement?.getAttribute("transform");
    act(() =>
      useApp.getState().setView(() => ({ scale: 2, panX: 20, panY: 40 })),
    );
    expect(graphic()?.getAttribute("font-size")).toBe("28");
    expect(graphic()?.getAttribute("font-weight")).toBe("600");
    expect(graphic()?.parentElement?.getAttribute("transform")).toBe(anchor);
    expect(anchor).toBe("translate(600 400)");
  });

  it("pans an edge draft into view and keeps its world anchor on Enter", () => {
    setup({ tool: "label" });
    const store = useApp.getState();
    const canvasSize = { width: 400, height: 260 };
    const initial = { scale: 1.25, panX: 20, panY: 10 };
    act(() => {
      store.setCanvasSize(canvasSize);
      store.setView(() => initial);
    });
    down(1, 395, 255);
    up(1, 395, 255);
    const position = { x: 300, y: 196 };
    const field = screen.getByRole<HTMLInputElement>("textbox", {
      name: "Label text",
    });
    expect(view().panX).toBeLessThan(initial.panX);
    expect(view().panY).toBeLessThan(initial.panY);
    expect(useApp.getState().labelEditor?.position).toEqual(position);

    const text = "Desk";
    fireEvent.change(field, { target: { value: text } });
    const { x, y, w, h } = planLabelRect({ position, text });
    const editingView = view();
    expect(editingView.scale).toBe(initial.scale);
    expect(x * editingView.scale + editingView.panX).toBeGreaterThan(0);
    expect((x + w) * editingView.scale + editingView.panX).toBeLessThan(
      canvasSize.width,
    );
    expect(y * editingView.scale + editingView.panY).toBeGreaterThan(0);
    expect((y + h) * editingView.scale + editingView.panY).toBeLessThan(
      canvasSize.height,
    );
    expect(useApp.getState().plan.labels).toBeUndefined();

    fireEvent.keyDown(field, { key: "Enter" });
    expect(view()).toEqual(editingView);
    expect(useApp.getState().plan.labels?.[0]).toMatchObject({
      position,
      text,
    });
    expect(loadPersistedHistory()?.past).toHaveLength(1);
  });

  it("draws and follows the caret using the rendered glyph positions at the canvas edge", () => {
    setup({ tool: "label" });
    act(() => useApp.getState().setCanvasSize({ width: 300, height: 200 }));
    down(1, 50, 100);
    up(1, 50, 100);
    expect(view()).toEqual(DEFAULT_VIEW);

    const field = screen.getByRole<HTMLInputElement>("textbox", {
      name: "Label text",
    });
    const draftLayer = canvas.querySelector(
      '[data-layer="label-edit-preview"]',
    )!;
    const svgText = draftLayer.querySelector("text")!;
    // jsdom has no SVG text layout. Make the actual glyph advance differ from
    // the fallback width so both the caret and the pan must use the SVG value.
    const glyphWidth = 46;
    Object.defineProperties(svgText, {
      getNumberOfChars: { value: () => svgText.textContent?.length ?? 0 },
      getStartPositionOfChar: {
        value: (index: number) => ({ x: index * glyphWidth }),
      },
      getEndPositionOfChar: {
        value: (index: number) => ({ x: (index + 1) * glyphWidth }),
      },
    });
    const caretX = () =>
      Number(draftLayer.querySelector("line")?.getAttribute("x1"));
    const text = "A label longer than the canvas";
    fireEvent.change(field, { target: { value: text } });
    const endView = view();
    expect(caretX()).toBe(text.length * glyphWidth);
    expect(50 + endView.panX + caretX()).toBeCloseTo(284);
    expect(endView.scale).toBe(1);
    expect(endView.panY).toBe(0);

    field.setSelectionRange(0, 0);
    fireEvent.keyUp(field, { key: "Home" });
    expect(caretX()).toBe(0);
    expect(50 + view().panX + caretX()).toBeCloseTo(16);

    field.setSelectionRange(text.length, text.length);
    fireEvent.keyUp(field, { key: "End" });
    expect(caretX()).toBe(text.length * glyphWidth);
    expect(view()).toEqual(endView);
  });

  it("saves the current label and exits entry when switching to Select", () => {
    setup({ tool: "label" });
    render(<Toolbar />);
    down(1, 400, 200);
    up(1, 400, 200);
    fireEvent.change(screen.getByRole("textbox", { name: "Label text" }), {
      target: { value: "Terrace" },
    });
    const select = screen.getByRole("button", { name: "Select" });
    fireEvent(select, pointerEvent("pointerdown", 1, 10, 10));
    fireEvent.click(select);
    expect(screen.queryByRole("textbox", { name: "Label text" })).toBeNull();
    expect(useApp.getState().tool).toBe("select");
    expect(useApp.getState().plan.labels?.[0]).toMatchObject({
      position: { x: 400, y: 200 },
      text: "Terrace",
    });
  });

  it("keeps a label at its saved start point while editing", () => {
    const label = { id: "l1", position: { x: 500, y: 300 }, text: "Terrace" };
    setup({
      tool: "select",
      plan: { ...createInitialPlan(), labels: [label] },
    });
    for (let i = 0; i < 2; i++) {
      down(1, 500, 300);
      up(1, 500, 300);
    }
    const field = screen.getByRole("textbox", { name: "Label text" });
    const draft = canvas.querySelector(
      '[data-layer="label-edit-preview"] text',
    )!;
    expect(draft.parentElement?.getAttribute("transform")).toBe(
      "translate(500 300)",
    );
    fireEvent.change(field, { target: { value: "Longer label" } });
    fireEvent.keyDown(field, { key: "Enter" });
    expect(useApp.getState().plan.labels).toEqual([
      { ...label, text: "Longer label" },
    ]);
  });

  it.each([
    { modifier: "ctrlKey", release: { x: 460, y: 220 } },
    { modifier: "metaKey", release: { x: 400, y: 200 } },
  ] as const)("preserves Redo after $modifier+Z interrupts a label drag", ({
    modifier,
    release,
  }) => {
    setup({ tool: "label" });
    down(1, 400, 200);
    up(1, 400, 200);
    const field = screen.getByRole("textbox", { name: "Label text" });
    fireEvent.change(field, { target: { value: "Terrace" } });
    fireEvent.keyDown(field, { key: "Enter" });
    const original = useApp.getState().plan.labels;
    expect(original).toHaveLength(1);

    act(() => useApp.getState().setTool("select"));
    down(1, 400, 200, { pointerType: "mouse" });
    move(1, 440, 220);
    expect(useApp.getState().plan.labels?.[0].position).toEqual({
      x: 440,
      y: 220,
    });

    fireEvent.keyDown(window, { key: "z", [modifier]: true });
    expect(useApp.getState().plan.labels ?? []).toHaveLength(0);
    up(1, release.x, release.y);
    expect(useApp.getState().selectedLabels.size).toBe(0);

    fireEvent.keyDown(window, { key: "z", shiftKey: true, [modifier]: true });
    expect(useApp.getState().plan.labels).toEqual(original);
  });

  it("discards an endpoint drag when the toolbar redoes a plan change", () => {
    setup({ tool: "select", plan: cornerPlan() });
    render(<Toolbar />);
    const original = walls();
    const added = wall(0, 350, 400, 350, "w3");
    act(() => useApp.getState().addWall(added));
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    act(() => useApp.getState().selectWall("w1"));

    down(1, 0, 0, { pointerType: "mouse" });
    move(1, 40, 40);
    expect(walls()[0].a).toEqual({ x: 40, y: 40 });

    fireEvent.click(screen.getByRole("button", { name: "Redo" }));
    move(1, 60, 60);
    up(1, 60, 60);
    expect(walls()).toEqual([...original, added]);

    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(walls()).toEqual(original);
  });

  it("marquee-selects labels by their text bounds alongside walls and moves selected labels together", () => {
    const labels = [
      {
        id: "terrace",
        text: "Terrace",
        position: { x: 100, y: 90 },
      },
      {
        id: "garden",
        text: "Garden",
        position: { x: 175, y: 160 },
      },
      {
        id: "outside",
        text: "Outside",
        position: { x: 175, y: 250 },
      },
    ] as const;
    const plan = {
      ...createInitialPlan(),
      walls: [wall(0, 0, 400, 0, "w1")],
      labels: [...labels],
    };
    setup({ plan, tool: "select" });
    const selectRegion = (top: number) => {
      down(1, 170, top);
      move(1, 190, 200);
      up(1, 190, 200);
    };
    const state = useApp.getState;
    selectRegion(-25);
    expect(state().selectedWalls).toEqual(new Set(["w1"]));
    expect(state().selectedLabels).toEqual(new Set(["terrace", "garden"]));
    expect(
      canvas.querySelectorAll('[data-layer="plan-labels"] rect'),
    ).toHaveLength(2);
    fireEvent.keyDown(window, { key: "Delete" });
    expect(state().plan.walls).toEqual([]);
    expect(state().plan.labels).toEqual([labels[2]]);
    act(() => state().undo());
    expect(state().plan.walls).toEqual(plan.walls);
    expect(state().plan.labels).toEqual(labels);

    selectRegion(30);
    down(1, 101, 90);
    move(1, 121, 120);
    expect(loadPersistedHistory()?.present.labels).toEqual(labels);
    up(1, 121, 120);
    expect(state().plan.labels?.map(({ position }) => position)).toEqual([
      { x: 120, y: 120 },
      { x: 195, y: 190 },
      labels[2].position,
    ]);
    expect(state().plan.walls).toEqual(plan.walls);
    act(() => state().undo());
    expect(state().plan.labels).toEqual(labels);
  });

  it.each([
    "wall",
    "label",
  ] as const)("moves a marquee selection together when dragging its %s", (grab) => {
    const plan: Plan = {
      ...createInitialPlan(),
      walls: [wall(0, 0, 400, 0, "w1")],
      items: [
        {
          id: "window",
          type: "window",
          wallAttach: { wallId: "w1", offset: 90, length: 80 },
          thickness: 10,
          props: {},
        },
      ],
      labels: [
        { id: "inside", text: "Kitchen", position: { x: 100, y: 90 } },
        { id: "outside", text: "Terrace", position: { x: 600, y: 150 } },
      ],
    };
    setup({ plan, tool: "select" });
    const state = useApp.getState;
    down(1, 55, -25);
    move(1, 250, 130);
    up(1, 250, 130);
    expect(state().selectedWalls).toEqual(new Set(["w1"]));
    expect(state().selectedItems).toEqual(new Set(["window"]));
    expect(state().selectedLabels).toEqual(new Set(["inside"]));

    const [x, y] = grab === "wall" ? [220, 0] : [100, 90];
    const movedWalls = [wall(40, 40, 440, 40, "w1")];
    const movedLabels = [
      { ...plan.labels![0], position: { x: 140, y: 130 } },
      plan.labels![1],
    ];
    down(1, x, y);
    move(1, x + 37, y + 43);
    expect(walls()).toEqual(movedWalls);
    expect(state().plan.labels).toEqual(movedLabels);
    expect(state().plan.items).toEqual(plan.items);
    expect(loadPersistedHistory()?.past).toHaveLength(0);
    cancel(1, x + 37, y + 43);
    expect(walls()).toEqual(plan.walls);
    expect(state().plan.labels).toEqual(plan.labels);
    expect(loadPersistedHistory()?.past).toHaveLength(0);

    down(1, x, y);
    move(1, x + 37, y + 43);
    up(1, x + 37, y + 43);
    expect(walls()).toEqual(movedWalls);
    expect(state().plan.labels).toEqual(movedLabels);
    expect(loadPersistedHistory()?.past).toHaveLength(1);
    act(() => state().undo());
    expect(walls()).toEqual(plan.walls);
    expect(state().plan.labels).toEqual(plan.labels);
    act(() => state().redo());
    expect(walls()).toEqual(movedWalls);
    expect(state().plan.labels).toEqual(movedLabels);
  });

  it("nudges selected walls and labels together with the arrow keys", () => {
    const labels = [
      { id: "l1", text: "Kitchen", position: { x: 100, y: 90 } },
      { id: "l2", text: "Dining", position: { x: 175, y: 160 } },
      { id: "l3", text: "Terrace", position: { x: 600, y: 150 } },
    ];
    const original = {
      ...createInitialPlan(),
      walls: [wall(0, 0, 400, 0, "w1")],
      labels,
    };
    setup({ plan: original, tool: "select" });
    const state = useApp.getState;
    act(() => {
      state().selectLabels(["l1", "l2"]);
      state().selectWall("w1", true);
    });

    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(walls()).toEqual([wall(20, 0, 420, 0, "w1")]);
    expect(state().plan.labels?.map(({ position }) => position)).toEqual([
      { x: 120, y: 90 },
      { x: 195, y: 160 },
      labels[2].position,
    ]);
    expect(loadPersistedHistory()?.past).toHaveLength(1);
    act(() => state().undo());
    expect(state().plan).toEqual(original);

    act(() => state().selectLabels(["l1", "l2"]));
    fireEvent.keyDown(window, { key: "ArrowUp", altKey: true });
    expect(walls()).toEqual(original.walls);
    expect(state().plan.labels?.map(({ position }) => position)).toEqual([
      { x: 100, y: 89 },
      { x: 175, y: 159 },
      labels[2].position,
    ]);
  });

  it("adjusts thickness with bracket keys only for wall-only selections", () => {
    const original: Plan = {
      ...cornerPlan(),
      items: [
        {
          id: "window",
          type: "window",
          wallAttach: { wallId: "w1", offset: 90, length: 80 },
          thickness: 10,
          props: {},
        },
      ],
      labels: [{ id: "l1", text: "Kitchen", position: { x: 100, y: 90 } }],
    };
    setup({ plan: original, tool: "select" });
    const state = useApp.getState;

    act(() => {
      state().selectWall("w1");
      state().selectLabels(["l1"], true);
    });
    fireEvent.keyDown(window, { key: "]" });
    expect(state().plan).toEqual(original);

    act(() => {
      state().selectWall("w1");
      state().selectItem("window", true);
    });
    fireEvent.keyDown(window, { key: "[" });
    expect(state().plan).toEqual(original);
    expect(loadPersistedHistory()?.past).toHaveLength(0);

    act(() => {
      state().selectWall("w1");
      state().selectWall("w2", true);
    });
    fireEvent.keyDown(window, { key: "]" });
    expect(walls().map(({ thickness }) => thickness)).toEqual([11, 11]);
    fireEvent.keyDown(window, { key: "[" });
    expect(walls().map(({ thickness }) => thickness)).toEqual([10, 10]);
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

  it("keeps the basin flush when resizing and preserves its attachment in storage", () => {
    const original = enclosedPlan();
    original.items.push({
      id: "window",
      type: "window",
      wallAttach: { wallId: "w1", offset: 90, length: 80 },
      thickness: 10,
      props: {},
    });
    setup({ plan: original });
    render(
      <>
        <Toolbar />
        <WallOptionsBar />
      </>,
    );
    const button = (name: string) => screen.getByRole("button", { name });
    const fixture = () => useApp.getState().plan.fixtures?.[0];
    const selection = () => canvas.querySelector("[data-fixture-selection]");

    fireEvent.click(button("Sink"));
    down(1, 500, 160, { pointerType: "mouse" });
    up(1, 500, 160, "mouse");
    expect(fixture()).toBeUndefined();
    expect(fixturePreview()).toBeNull();
    expect(
      screen.queryByText("Point closer to a wall face to place the sink."),
    ).toBeNull();
    expect(button("Sink").getAttribute("aria-pressed")).toBe("true");
    const backEdge = "translate(405 160) rotate(270)";
    move(1, 465, 160, { pointerType: "mouse", buttons: 0 });
    expect(fixturePreview()?.getAttribute("data-fixture-preview")).toBe(
      "valid",
    );
    expect(fixturePreview()?.getAttribute("transform")).toBe(backEdge);
    expect(
      fixturePreview()?.querySelector("rect")?.getAttribute("height"),
    ).toBe("60");
    expect(fixture()).toBeUndefined();
    down(1, 465, 160, { pointerType: "mouse" });
    up(1, 465, 160, "mouse");
    expect(fixture()).toMatchObject({
      type: "sink",
      wallAttach: { wallId: "w2", offset: 130, length: 60 },
      side: -1,
      depth: 60,
    });
    expect(selection()?.parentElement?.getAttribute("transform")).toBe(
      backEdge,
    );
    expect(screen.queryByRole("button", { name: /rotate/i })).toBeNull();

    const width = screen.getByRole("spinbutton", { name: "Width" });
    fireEvent.change(width, { target: { value: "90.25" } });
    expect(fixturePreview()?.getAttribute("data-fixture-preview")).toBe(
      "valid",
    );
    expect(fixturePreview()?.querySelector("rect")?.getAttribute("width")).toBe(
      "90.25",
    );
    expect(canvas.querySelector('[data-fixture="sink"]')).toBeNull();
    expect(fixture()?.wallAttach.length).toBe(60);
    fireEvent.keyDown(width, { key: "Enter" });
    expect(fixturePreview()).toBeNull();
    expect(selection()?.getAttribute("width")).toBe("90.25");
    expect((width as HTMLInputElement).value).toBe("90.25");
    const depth = screen.getByRole("spinbutton", { name: "Depth" });
    fireEvent.change(depth, { target: { value: "75.5" } });
    fireEvent.keyDown(depth, { key: "Enter" });
    expect(selection()?.getAttribute("height")).toBe("75.5");
    expect(selection()?.getAttribute("y")).toBe("0");
    expect(selection()?.parentElement?.getAttribute("transform")).toBe(
      backEdge,
    );
    expect(loadPersistedHistory()?.past).toHaveLength(3);

    fireEvent.click(button("Undo"));
    expect(fixture()).toMatchObject({
      wallAttach: { offset: 114.875, length: 90.25 },
      depth: 60,
    });
    expect(loadPersistedHistory()?.present.fixtures).toEqual([fixture()]);
    fireEvent.click(button("Redo"));
    const restored = loadPersistedHistory()?.present;
    expect(restored?.fixtures?.[0]).toMatchObject({
      wallAttach: { wallId: "w2", offset: 114.875, length: 90.25 },
      side: -1,
      depth: 75.5,
    });
    expect(parsePlan(serializePlan(restored!)).fixtures).toEqual([fixture()]);
    expect(restored?.walls).toEqual(original.walls);
    expect(restored?.items).toEqual(original.items);
    expect(detectRooms(restored!.walls)).toEqual(detectRooms(original.walls));

    act(() => useApp.getState().loadPlan(restored!));
    expect(
      canvas.querySelector('[data-fixture="sink"]')?.getAttribute("transform"),
    ).toBe(backEdge);
    act(() => useApp.getState().setCanvasSize({ width: 800, height: 600 }));
    fireEvent.click(button("Fit"));
    const { scale, panX, panY } = view();
    const { maxX, minY, maxY } = getFixtureBounds(
      fixture()!,
      original.walls[1],
    );
    expect(maxX * scale + panX).toBeLessThan(800);
    expect(minY * scale + panY).toBeGreaterThan(0);
    expect(maxY * scale + panY).toBeLessThan(600);
  });

  it("previews a touch slide and places at the same footprint on release", () => {
    setup({
      tool: "sink",
      plan: {
        ...createInitialPlan(),
        walls: [wall(20, 120, 480, 120, "host")],
      },
    });
    const state = useApp.getState;
    down(1, 130, 300);
    expect(fixturePreview()).toBeNull();
    up(1, 130, 300);
    expect(
      screen.queryByText("Point closer to a wall face to place the sink."),
    ).toBeNull();
    expect(state().tool).toBe("sink");
    down(1, 130, 300);
    move(1, 180, 185);
    const preview = fixturePreview();
    expect(preview?.getAttribute("data-fixture-preview")).toBe("valid");
    expect(preview?.getAttribute("transform")).toBe(
      "translate(180 125) rotate(0)",
    );
    expect(state().plan.fixtures).toBeUndefined();
    up(1, 180, 185);
    expect(
      canvas.querySelector('[data-fixture="sink"]')?.getAttribute("transform"),
    ).toBe(preview?.getAttribute("transform"));
    expect(state().tool).toBe("select");
    expect(
      screen.queryByText("Point closer to a wall face to place the sink."),
    ).toBeNull();
    expect(loadPersistedHistory()?.past).toHaveLength(1);
  });

  it("rejects sink placement on both faces of a doorway and preserves a valid width", () => {
    const plan: Plan = {
      ...createInitialPlan(),
      walls: [wall(20, 160, 480, 160, "host")],
      items: [
        {
          id: "door",
          type: "door",
          thickness: 18,
          wallAttach: { wallId: "host", offset: 170, length: 70 },
          props: { hingeEdge: "start", swingSide: "inside" },
        },
      ],
    };
    setup({ tool: "sink", plan });
    render(<WallOptionsBar />);
    const state = useApp.getState;
    move(1, 220, 180, { pointerType: "mouse", buttons: 0 });
    expect(screen.queryByText("The sink overlaps a doorway.")).toBeNull();
    for (const y of [180, 140]) {
      down(1, 220, y);
      expect(fixturePreview()?.getAttribute("data-fixture-preview")).toBe(
        "blocked",
      );
      expect(screen.queryByText("The sink overlaps a doorway.")).toBeNull();
      up(1, 220, y);
      expect(screen.queryByText("The sink overlaps a doorway.")).toBeNull();
      expect(state().plan).toBe(plan);
      expect(state().tool).toBe("sink");
    }
    expect(loadPersistedHistory()?.past).toHaveLength(0);
    down(1, 290, 180);
    expect(fixturePreview()?.getAttribute("data-fixture-preview")).toBe(
      "valid",
    );
    up(1, 290, 180);
    const mountedPlan = state().plan;
    expect(mountedPlan.fixtures?.[0]?.wallAttach.offset).toBe(240);
    const width = screen.getByRole<HTMLInputElement>("spinbutton", {
      name: "Width",
    });
    fireEvent.change(width, { target: { value: "75.25" } });
    expect(fixturePreview()?.getAttribute("data-fixture-preview")).toBe(
      "blocked",
    );
    expect(screen.queryByText(/Move it clear of the doorway/)).toBeNull();
    fireEvent.keyDown(width, { key: "Enter" });
    expect(width.value).toBe("60");
    expect(fixturePreview()).toBeNull();
    expect(screen.queryByText(/Move it clear of the doorway/)).toBeNull();
    expect(state().plan).toBe(mountedPlan);
    expect(loadPersistedHistory()?.past).toHaveLength(1);
  });

  it("rejects placement, movement, and a depth edit that intersect an adjoining acute wall", () => {
    const plan: Plan = {
      ...createInitialPlan(),
      walls: [
        wall(40, 100, 440, 100, "host"),
        wall(40, 100, 440, 200, "angled"),
      ],
    };
    setup({ tool: "sink", plan });
    render(<WallOptionsBar />);
    const state = useApp.getState;
    down(1, 210, 110);
    expect(fixturePreview()?.getAttribute("transform")).toBe(
      "translate(210 105) rotate(0)",
    );
    expect(fixturePreview()?.getAttribute("data-fixture-preview")).toBe(
      "blocked",
    );
    expect(
      screen.queryByText("The sink overlaps a wall or corner."),
    ).toBeNull();
    up(1, 210, 110);
    expect(state().plan).toBe(plan);
    expect(loadPersistedHistory()?.past).toHaveLength(0);

    down(1, 365, 115);
    expect(fixturePreview()?.getAttribute("data-fixture-preview")).toBe(
      "valid",
    );
    up(1, 365, 115);
    const mountedPlan = state().plan;
    expect(mountedPlan.fixtures?.[0]).toMatchObject({
      wallAttach: { wallId: "host", offset: 295, length: 60 },
      depth: 60,
    });
    const depth = screen.getByRole<HTMLInputElement>("spinbutton", {
      name: "Depth",
    });
    fireEvent.change(depth, { target: { value: "90" } });
    expect(fixturePreview()?.getAttribute("data-fixture-preview")).toBe(
      "blocked",
    );
    expect(
      fixturePreview()?.querySelector("rect")?.getAttribute("height"),
    ).toBe("90");
    expect(canvas.querySelector('[data-fixture="sink"]')).toBeNull();
    expect(screen.queryByText(/Move it away from the corner/)).toBeNull();
    expect(state().plan).toBe(mountedPlan);
    fireEvent.keyDown(depth, { key: "Enter" });
    expect(depth.value).toBe("60");
    expect(fixturePreview()).toBeNull();
    expect(screen.queryByText(/Move it away from the corner/)).toBeNull();
    fireEvent.change(depth, { target: { value: "45" } });
    expect(fixturePreview()?.getAttribute("data-fixture-preview")).toBe(
      "valid",
    );
    fireEvent.keyDown(depth, { key: "Escape" });
    expect(depth.value).toBe("60");
    expect(fixturePreview()).toBeNull();
    expect(screen.queryByText(/Move it away from the corner/)).toBeNull();
    expect(state().plan).toBe(mountedPlan);

    const renderedSink = () => canvas.querySelector('[data-fixture="sink"]');
    const originalTransform = renderedSink()?.getAttribute("transform");
    expect(originalTransform).toBe("translate(365 105) rotate(0)");
    down(1, 365, 120);
    move(1, 390, 120);
    expect(fixturePreview()?.getAttribute("data-fixture-preview")).toBe(
      "valid",
    );
    expect(renderedSink()).toBeNull();
    move(1, 210, 115);
    expect(fixturePreview()?.getAttribute("data-fixture-preview")).toBe(
      "blocked",
    );
    expect(renderedSink()).toBeNull();
    expect(
      screen.queryByText("The sink overlaps a wall or corner."),
    ).toBeNull();
    up(1, 210, 115);
    expect(fixturePreview()).toBeNull();
    expect(renderedSink()?.getAttribute("transform")).toBe(originalTransform);
    expect(state().plan).toBe(mountedPlan);
    expect(
      screen.queryByText("The sink overlaps a wall or corner."),
    ).toBeNull();
    expect(loadPersistedHistory()?.past).toHaveLength(1);
  });

  it.each([
    "mouse",
    "touch",
  ])("moves a marquee selection of sinks together by %s", (pointerType) => {
    const plan: Plan = {
      ...createInitialPlan(),
      walls: [wall(0, 160, 600, 160, "host")],
      items: [
        {
          id: "door",
          type: "door",
          thickness: 18,
          wallAttach: { wallId: "host", offset: 370, length: 60 },
          props: { hingeEdge: "start", swingSide: "inside" },
        },
      ],
      fixtures: [100, 260].map((offset, index) => ({
        id: `sink-${index}`,
        type: "sink",
        depth: 60,
        side: 1,
        wallAttach: { wallId: "host", length: 60, offset },
      })),
    };
    setup({ tool: "select", plan });
    const state = useApp.getState;
    const input = { pointerType };
    down(1, 60, 178, input);
    move(1, 340, 245, input);
    up(1, 340, 245, pointerType);
    const selection = new Set(["sink-0", "sink-1"]);
    expect(state().selectedFixtures).toEqual(selection);

    down(1, 130, 195, input);
    expect(state().selectedFixtures).toEqual(selection);
    move(1, 175, 195, input);
    expect(
      Array.from(
        canvas.querySelectorAll('[data-fixture-preview="valid"]'),
        (node) => node.getAttribute("transform"),
      ),
    ).toEqual(["translate(175 165) rotate(0)", "translate(335 165) rotate(0)"]);
    expect(canvas.querySelectorAll('[data-fixture="sink"]')).toHaveLength(0);
    expect(state().plan).toBe(plan);
    up(1, 175, 195, pointerType);
    const moved = state().plan;
    expect(moved.fixtures?.map((fixture) => fixture.wallAttach.offset)).toEqual(
      [145, 305],
    );
    expect(state().selectedFixtures).toEqual(selection);
    expect(loadPersistedHistory()?.past).toHaveLength(1);

    down(1, 175, 195, input);
    move(1, 220, 195, input);
    expect(
      canvas.querySelectorAll('[data-fixture-preview="blocked"]'),
    ).toHaveLength(2);
    expect(screen.queryByText("The sink overlaps a doorway.")).toBeNull();
    up(1, 220, 195, pointerType);
    expect(state().plan).toBe(moved);
    expect(state().selectedFixtures).toEqual(selection);
    expect(loadPersistedHistory()?.past).toHaveLength(1);
    act(() => state().undo());
    expect(state().plan.fixtures).toEqual(plan.fixtures);
    expect(state().selectedFixtures).toEqual(selection);
  });

  it.each([
    { withOpening: false },
    { withOpening: true },
  ])("nudges a pair of sinks as a single edit (opening selected: $withOpening)", ({
    withOpening,
  }) => {
    const plan: Plan = {
      ...createInitialPlan(),
      walls: [wall(0, 160, 600, 160, "host")],
      items: [
        {
          id: "door",
          type: "door",
          thickness: 18,
          wallAttach: { wallId: "host", offset: 320, length: 60 },
          props: { hingeEdge: "start", swingSide: "inside" },
        },
      ],
      fixtures: [100, 260].map((offset, index) => ({
        id: `sink-${index}`,
        type: "sink",
        depth: 60,
        side: 1,
        wallAttach: { wallId: "host", length: 60, offset },
      })),
    };
    setup({ tool: "select", plan });
    const state = useApp.getState;
    down(1, 60, 178);
    move(1, 340, 245);
    up(1, 340, 245);
    const selected = new Set(["sink-0", "sink-1"]);
    const selectedItems = new Set(withOpening ? ["door"] : []);
    if (withOpening) {
      down(1, 350, 160, { pointerType: "mouse", shiftKey: true });
      up(1, 350, 160, "mouse");
    }
    expect(state().selectedFixtures).toEqual(selected);
    expect(state().selectedItems).toEqual(selectedItems);

    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(state().plan).toBe(plan);
    expect(state().selectedFixtures).toEqual(selected);
    expect(state().selectedItems).toEqual(selectedItems);
    expect(loadPersistedHistory()?.past).toHaveLength(0);

    fireEvent.keyDown(window, { key: "ArrowLeft" });
    expect(
      state().plan.fixtures?.map(({ wallAttach }) => wallAttach.offset),
    ).toEqual([80, 240]);
    expect(state().plan.items).toEqual(plan.items);
    expect(state().selectedFixtures).toEqual(selected);
    expect(state().selectedItems).toEqual(selectedItems);
    expect(loadPersistedHistory()?.past).toHaveLength(1);
    act(() => state().undo());
    expect(state().plan.fixtures).toEqual(plan.fixtures);
  });

  it("slides sinks on separate parallel walls without reattaching either sink", () => {
    const plan: Plan = {
      ...createInitialPlan(),
      walls: [wall(0, 100, 500, 100, "upper"), wall(500, 250, 0, 250, "lower")],
      fixtures: [
        {
          id: "upper-sink",
          type: "sink",
          side: 1,
          depth: 60,
          wallAttach: { wallId: "upper", offset: 80, length: 60 },
        },
        {
          id: "lower-sink",
          type: "sink",
          side: 1,
          depth: 60,
          wallAttach: { wallId: "lower", offset: 90, length: 60 },
        },
      ],
    };
    setup({ tool: "select", plan });
    const state = useApp.getState;
    down(1, 45, 122);
    move(1, 450, 230);
    up(1, 450, 230);
    expect(state().selectedFixtures).toEqual(
      new Set(["upper-sink", "lower-sink"]),
    );

    down(1, 110, 133);
    // The pointer is near the lower face, but each selected sink keeps its own wall.
    move(1, 160, 246);
    expect(
      Array.from(
        canvas.querySelectorAll('[data-fixture-preview="valid"]'),
        (node) => node.getAttribute("transform"),
      ),
    ).toEqual([
      "translate(160 105) rotate(0)",
      "translate(430 245) rotate(180)",
    ]);
    up(1, 160, 246);
    const moved = state().plan;
    expect(moved.fixtures?.map(({ wallAttach }) => wallAttach)).toEqual([
      { wallId: "upper", offset: 130, length: 60 },
      { wallId: "lower", offset: 40, length: 60 },
    ]);
    expect(loadPersistedHistory()?.past).toHaveLength(1);

    down(1, 160, 133);
    move(1, 230, 246);
    expect(
      canvas.querySelectorAll('[data-fixture-preview="blocked"]'),
    ).toHaveLength(2);
    expect(
      screen.queryByText("The sink extends beyond the wall face."),
    ).toBeNull();
    up(1, 230, 246);
    expect(state().plan).toBe(moved);
    expect(loadPersistedHistory()?.past).toHaveLength(1);
  });

  it("keeps sinks on perpendicular walls in place with their selection outlines", () => {
    const plan: Plan = {
      ...createInitialPlan(),
      walls: [
        wall(0, 100, 500, 100, "horizontal"),
        wall(420, 160, 420, 400, "vertical"),
      ],
      fixtures: [
        {
          id: "first",
          type: "sink",
          side: 1,
          depth: 60,
          wallAttach: { wallId: "horizontal", offset: 80, length: 60 },
        },
        {
          id: "second",
          type: "sink",
          side: 1,
          depth: 60,
          wallAttach: { wallId: "vertical", offset: 50, length: 60 },
        },
      ],
    };
    setup({ tool: "select", plan });
    const state = useApp.getState;
    act(() => {
      state().selectFixture("first");
      state().selectFixture("second", true);
    });
    const reason =
      "The selected sinks are on walls at different angles. Move them separately.";
    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(screen.queryByText(reason)).toBeNull();
    expect(state().plan).toBe(plan);

    down(1, 110, 133);
    move(1, 160, 133);
    expect(screen.queryByText(reason)).toBeNull();
    expect(fixturePreview()).toBeNull();
    expect(canvas.querySelectorAll("[data-fixture-selection]")).toHaveLength(2);
    up(1, 160, 133);
    expect(state().plan).toBe(plan);
    expect(loadPersistedHistory()?.past).toHaveLength(0);
  });

  it.each([
    { grab: "label", pointerType: "mouse", x: 205, y: 250 },
    { grab: "sink", pointerType: "touch", x: 150, y: 155 },
  ])("keeps labels and sinks together when dragging the $grab", ({
    pointerType,
    x,
    y,
  }) => {
    const plan: Plan = {
      ...createInitialPlan(),
      walls: [wall(0, 120, 480, 120, "host")],
      labels: [
        { id: "kitchen", text: "Kitchen", position: { x: 200, y: 255 } },
      ],
      fixtures: [120, 320].map((offset, index) => ({
        id: `sink-${index}`,
        type: "sink",
        side: 1,
        depth: 60,
        wallAttach: { wallId: "host", offset, length: 60 },
      })),
    };
    setup({ tool: "select", plan });
    const state = useApp.getState;
    const input = { pointerType };
    const previewSinks = (validity: string) =>
      Array.from(
        canvas.querySelectorAll(`[data-fixture-preview="${validity}"]`),
        (node) => node.getAttribute("transform"),
      );
    down(1, 60, 150, input);
    move(1, 420, 280, input);
    up(1, 420, 280, pointerType);
    expect(state().selectedFixtures).toEqual(new Set(["sink-0", "sink-1"]));
    expect(state().selectedLabels).toEqual(new Set(["kitchen"]));

    fireEvent.keyDown(window, { key: "ArrowRight", shiftKey: true });
    expect(state().plan).toBe(plan);
    expect(loadPersistedHistory()?.past).toHaveLength(0);

    down(1, x, y, input);
    move(1, x + 150, y + 10, input);
    expect(previewSinks("blocked")).toEqual([
      "translate(300 125) rotate(0)",
      "translate(500 125) rotate(0)",
    ]);
    const blockedLabel = canvas.querySelector('[data-label-preview="blocked"]');
    expect(blockedLabel?.getAttribute("transform")).toBe("translate(350 255)");
    expect(blockedLabel?.querySelector("rect")?.getAttribute("stroke")).toBe(
      "var(--sp-sink-blocked)",
    );
    expect(
      screen.queryByText("The sink extends beyond the wall face."),
    ).toBeNull();
    up(1, x + 150, y + 10, pointerType);
    expect(state().plan).toBe(plan);
    expect(loadPersistedHistory()?.past).toHaveLength(0);
    expect(canvas.querySelector("[data-label-preview]")).toBeNull();
    expect(
      canvas
        .querySelector('[data-layer="plan-labels"] > g')
        ?.getAttribute("transform"),
    ).toBe("translate(200 255)");

    down(1, x, y, input);
    move(1, x + 65, y + 55, input);
    expect(previewSinks("valid")).toEqual([
      "translate(215 125) rotate(0)",
      "translate(415 125) rotate(0)",
    ]);
    expect(
      canvas
        .querySelector('[data-label-preview="valid"]')
        ?.getAttribute("transform"),
    ).toBe("translate(265 255)");
    expect(state().plan).toBe(plan);
    move(1, x + 600, y + 240, input);
    expect(previewSinks("valid")).toEqual([
      "translate(250 125) rotate(0)",
      "translate(450 125) rotate(0)",
    ]);
    expect(previewSinks("blocked")).toEqual([]);
    expect(
      canvas
        .querySelector('[data-label-preview="valid"]')
        ?.getAttribute("transform"),
    ).toBe("translate(300 255)");
    expect(state().plan).toBe(plan);
    up(1, x + 600, y + 240, pointerType);
    expect(state().plan.labels?.[0].position).toEqual({ x: 300, y: 255 });
    expect(
      state().plan.fixtures?.map(({ wallAttach }) => wallAttach.offset),
    ).toEqual([220, 420]);
    expect(loadPersistedHistory()?.past).toHaveLength(1);
    act(() => state().undo());
    expect(state().plan.labels).toEqual(plan.labels);
    expect(state().plan.fixtures).toEqual(plan.fixtures);
  });

  it.each([
    { grab: "label", pointerType: "mouse", x: 205, y: 250 },
    { grab: "sink", pointerType: "touch", x: 150, y: 155 },
  ])("reattaches sinks and their label together when dragging the $grab", ({
    pointerType,
    x,
    y,
  }) => {
    const plan: Plan = {
      ...createInitialPlan(),
      walls: [
        wall(0, 120, 500, 120, "source"),
        wall(650, 40, 650, 430, "target"),
      ],
      labels: [
        { id: "kitchen", text: "Kitchen", position: { x: 200, y: 255 } },
      ],
      fixtures: [120, 300].map((offset, index) => ({
        id: `sink-${index}`,
        type: "sink",
        side: 1,
        depth: 60,
        wallAttach: { wallId: "source", offset, length: 60 },
      })),
    };
    setup({ tool: "select", plan });
    const state = useApp.getState;
    const input = { pointerType };
    down(1, 60, 148, input);
    move(1, 400, 280, input);
    up(1, 400, 280, pointerType);
    expect(state().selectedFixtures).toEqual(new Set(["sink-0", "sink-1"]));
    expect(state().selectedLabels).toEqual(new Set(["kitchen"]));

    down(1, x, y, input);
    move(1, x + 475, y + 130, input);
    expect(
      canvas.querySelectorAll('[data-fixture-preview="blocked"]'),
    ).toHaveLength(2);
    expect(
      canvas
        .querySelector('[data-label-preview="blocked"]')
        ?.getAttribute("transform"),
    ).toBe("translate(515 335)");
    up(1, x + 475, y + 130, pointerType);
    expect(state().plan).toBe(plan);
    expect(loadPersistedHistory()?.past).toHaveLength(0);

    down(1, x, y, input);
    move(1, x + 475, y - 30, input);
    expect(
      Array.from(
        canvas.querySelectorAll('[data-fixture-preview="valid"]'),
        (node) => node.getAttribute("transform"),
      ),
    ).toEqual([
      "translate(645 125) rotate(90)",
      "translate(645 305) rotate(90)",
    ]);
    expect(
      canvas
        .querySelector('[data-label-preview="valid"]')
        ?.getAttribute("transform"),
    ).toBe("translate(515 175)");
    expect(state().plan).toBe(plan);
    up(1, x + 475, y - 30, pointerType);
    expect(state().plan.fixtures?.map(({ wallAttach }) => wallAttach)).toEqual([
      { wallId: "target", offset: 55, length: 60 },
      { wallId: "target", offset: 235, length: 60 },
    ]);
    expect(state().plan.labels?.[0].position).toEqual({ x: 515, y: 175 });
    expect(loadPersistedHistory()?.past).toHaveLength(1);
    act(() => state().undo());
    expect(state().plan.fixtures).toEqual(plan.fixtures);
    expect(state().plan.labels).toEqual(plan.labels);
  });

  it("keeps a typed width when the canvas press also starts a sink drag", () => {
    setup({
      tool: "sink",
      plan: {
        ...createInitialPlan(),
        walls: [wall(0, 100, 500, 100, "host")],
      },
    });
    render(<WallOptionsBar />);
    down(1, 120, 120);
    up(1, 120, 120);
    const width = screen.getByRole("spinbutton", { name: "Width" });
    act(() => width.focus());
    fireEvent.change(width, { target: { value: "85.5" } });
    down(1, 120, 120, { pointerType: "mouse" });
    expect(useApp.getState().plan.fixtures?.[0].wallAttach.length).toBe(85.5);
    move(1, 180, 120, { pointerType: "mouse" });
    expect(fixturePreview()?.querySelector("rect")?.getAttribute("width")).toBe(
      "85.5",
    );
    up(1, 180, 120, "mouse");
    expect(useApp.getState().plan.fixtures?.[0].wallAttach).toEqual({
      wallId: "host",
      offset: 137.25,
      length: 85.5,
    });
    expect(loadPersistedHistory()?.past).toHaveLength(3);
  });

  it("places two basins back to back on an angled divider", () => {
    setup({
      plan: {
        ...createInitialPlan(),
        walls: [{ ...wall(100, 100, 500, 500, "divider"), thickness: 20 }],
      },
    });
    render(<Toolbar />);
    const sink = screen.getByRole("button", { name: "Sink" });
    fireEvent.click(sink);
    down(1, 285, 315);
    up(1, 285, 315);
    fireEvent.click(screen.getByRole("button", { name: "Sink" }));
    down(1, 315, 285);
    up(1, 315, 285);

    const [first, second] = useApp.getState().plan.fixtures!;
    expect(first.wallAttach).toEqual(second.wallAttach);
    expect([first.side, second.side]).toEqual([1, -1]);
    const basins = canvas.querySelectorAll('[data-fixture="sink"]');
    expect(basins[0]?.getAttribute("transform")).toMatch(/rotate\(45\)$/);
    expect(basins[1]?.getAttribute("transform")).toMatch(/rotate\(225\)$/);

    // Touch padding must not select the basin on the other side.
    down(1, 292, 308);
    up(1, 292, 308);
    expect(useApp.getState().selectedFixtures).toEqual(new Set([first.id]));
  });

  it("slides a duplicate along its host and transfers it to another face by touch", () => {
    setup({
      plan: {
        ...createInitialPlan(),
        meta: { ...createInitialPlan().meta, measurementSystem: "imperial" },
        walls: [
          wall(0, 160, 500, 160, "upper"),
          wall(0, 400, 500, 400, "lower"),
        ],
      },
    });
    render(
      <>
        <Toolbar />
        <WallOptionsBar />
      </>,
    );
    const button = (name: string) => screen.getByRole("button", { name });
    const fixtures = () => useApp.getState().plan.fixtures;
    fireEvent.click(button("Sink"));
    down(1, 200, 180);
    down(2, 300, 180);
    up(2, 300, 180);
    up(1, 200, 180);
    expect(fixtures()).toBeUndefined();
    down(1, 200, 180);
    up(1, 200, 180);
    const original = fixtures()?.[0];

    fireEvent.click(button("Duplicate"));
    const copy = fixtures()?.[1];
    expect(copy?.id).not.toBe(original?.id);
    expect(copy?.wallAttach).toEqual({
      wallId: "upper",
      offset: 250,
      length: 60,
    });
    const depthFeet = screen.getByRole("spinbutton", { name: "Depth feet" });
    const depthInches = screen.getByRole("spinbutton", {
      name: "Depth inches",
    });
    fireEvent.change(depthFeet, { target: { value: "2" } });
    fireEvent.change(depthInches, { target: { value: "0" } });
    fireEvent.keyDown(depthInches, { key: "Enter" });
    expect(fixtures()?.[1].depth).toBeCloseTo(60.96);

    down(1, 280, 190);
    move(1, 320, 380);
    expect(fixturePreview()?.getAttribute("transform")).toBe(
      "translate(320 395) rotate(180)",
    );
    expect(fixtures()?.[1].wallAttach.wallId).toBe("upper");
    cancel(1, 320, 380);
    expect(fixtures()?.[1].wallAttach).toEqual(copy?.wallAttach);
    expect(loadPersistedHistory()?.past).toHaveLength(3);

    down(1, 280, 190);
    move(1, 300, 280);
    up(1, 320, 280);
    expect(fixtures()?.[1]).toMatchObject({
      wallAttach: { wallId: "upper", offset: 290 },
      side: 1,
    });
    down(1, 320, 190);
    move(1, 320, 275);
    up(1, 320, 380);
    expect(fixtures()?.[1]).toMatchObject({
      wallAttach: { wallId: "lower", offset: 290 },
      side: -1,
    });
    expect(fixtures()?.[0]).toEqual(original);
    expect(loadPersistedHistory()?.past).toHaveLength(5);
    fireEvent.click(button("Undo"));
    expect(fixtures()?.[1]).toMatchObject({
      wallAttach: { wallId: "upper", offset: 290 },
      side: 1,
    });
    fireEvent.click(button("Remove"));
    expect(fixtures()).toEqual([original]);
    fireEvent.click(button("Undo"));
    expect(fixtures()).toHaveLength(2);
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
