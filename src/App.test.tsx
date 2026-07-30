// @vitest-environment jsdom
import { CANVAS_POINTER_HINT } from "@app/canvasHint";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import App from "./App";

/**
 * Point `matchMedia` at a fixed answer for `(pointer: coarse)`. jsdom's own
 * implementation always reports `matches: false`, which already reads as a fine
 * pointer — so only the coarse case needs stubbing.
 */
function stubCoarsePointer(coarse: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: coarse && query.includes("pointer: coarse"),
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
}

/** The toolbar row — the element that holds the "Spacory" brand heading. */
function toolbarRow(): HTMLElement {
  const brand = screen.getByRole("heading", { name: "Spacory" });
  return brand.parentElement as HTMLElement;
}

describe("App shell — the pan/zoom tip", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it("renders in the canvas area, not in the toolbar row, on a fine pointer", () => {
    render(<App />);

    const tip = screen.getByText(CANVAS_POINTER_HINT);
    // It moved *out* of the toolbar: that row is what overflowed at 768px.
    expect(toolbarRow().contains(tip)).toBe(false);
    // ...and *into* the canvas area — the element that also holds the canvas.
    const canvasWrap = tip.parentElement as HTMLElement;
    expect(canvasWrap.querySelector("svg")).not.toBeNull();
  });

  it("does not render at all on a coarse pointer", () => {
    stubCoarsePointer(true);
    render(<App />);

    expect(screen.queryByText(CANVAS_POINTER_HINT)).toBeNull();
    // Nothing took its place: touch pan/zoom gestures don't exist yet (#84),
    // so no gesture advice of any kind is offered. (The "Pan" *tool* button is
    // still there — this looks for hint text, not controls.)
    expect(screen.queryByText(/drag to pan|pinch|two.finger/i)).toBeNull();
    // The controls it used to sit beside are still there and reachable.
    expect(screen.getByRole("button", { name: /Undo/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Redo/ })).toBeTruthy();
  });

  it("keeps every toolbar control rendered alongside it on a fine pointer", () => {
    render(<App />);

    for (const name of [/Select/, /Wall/, /Fit/, /Import/, /Export/, /Undo/]) {
      expect(screen.getByRole("button", { name })).toBeTruthy();
    }
  });
});
