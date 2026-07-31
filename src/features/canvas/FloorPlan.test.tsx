// @vitest-environment jsdom
import { createInitialPlan, type Plan, type Wall } from "@app/schema";
import type { Tool } from "@app/store";
import { useApp } from "@app/store";
import { DEFAULT_VIEW } from "@app/viewport";
import { cleanup, fireEvent, render } from "@testing-library/react";
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
  init: { button?: number; buttons?: number } = {},
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
    init?: { button?: number; buttons?: number },
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
