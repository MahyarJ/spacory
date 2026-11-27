// @vitest-environment jsdom
import { CANVAS_POINTER_HINT } from "@app/canvasHint";
import { useApp } from "@app/store";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
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

/**
 * The toolbar row — the element that holds the "Spacory" brand heading.
 *
 * The assertions built on this are *negative* ("the row does not contain the
 * tip"), so identifying the wrong element would make them pass vacuously.
 * Assert what the row must contain before handing it back.
 */
function toolbarRow(): HTMLElement {
  const brand = screen.getByRole("heading", { name: "Spacory" });
  const row = brand.closest("header")!;
  expect(row.contains(screen.getByRole("button", { name: /Undo/ }))).toBe(true);
  return row;
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
    // Nothing took its place: the canvas hint is desktop-only, so no gesture
    // advice of any kind is offered on a touch screen. (The "Pan" *tool* button
    // is still there — this looks for hint text, not controls.)
    expect(screen.queryByText(/drag to pan|pinch|two.finger/i)).toBeNull();
    // The controls it used to sit beside are still there and reachable.
    expect(screen.getByRole("button", { name: /Undo/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Redo/ })).toBeTruthy();
  });

  it("keeps common tools and actions directly accessible", () => {
    render(<App />);

    for (const name of [/Select/, /Wall/, /Fit/, /File/, /Settings/, /Undo/]) {
      expect(screen.getByRole("button", { name })).toBeTruthy();
    }
  });
});

describe("App shell — toolbar menus", () => {
  afterEach(() => {
    cleanup();
    useApp.getState().setTool("select");
    useApp.getState().setThemeMode("system");
    localStorage.clear();
  });

  it("selects an opening by keyboard and keeps its category active", () => {
    render(<App />);

    const openings = screen.getByRole("button", { name: "Openings" });
    openings.focus();
    fireEvent.keyDown(openings, { key: "ArrowDown" });
    const door = screen.getByRole("menuitemradio", { name: "Door" });
    const window = screen.getByRole("menuitemradio", { name: "Window" });
    expect(document.activeElement).toBe(door);
    fireEvent.keyDown(door, { key: "ArrowDown" });
    expect(document.activeElement).toBe(window);
    fireEvent.click(window);

    expect(useApp.getState().tool).toBe("window");
    expect(document.activeElement).toBe(openings);
    expect(openings.getAttribute("aria-label")).toBe("Openings (Window)");
    fireEvent.click(openings);
    expect(
      screen.getByRole("menuitemradio", { name: "Window", checked: true }),
    ).toBeTruthy();
    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Select" }));
    expect(openings.getAttribute("aria-label")).toBe("Openings");
  });

  it("exposes preferences through Settings and returns focus on Escape", () => {
    act(() => useApp.getState().setThemeMode("system"));
    render(<App />);

    const settings = screen.getByRole("button", { name: "Settings" });
    expect(screen.queryByRole("group", { name: "Theme" })).toBeNull();
    fireEvent.click(settings);
    const panel = screen.getByRole("region", { name: "Editor settings" });
    const light = within(panel).getByRole("button", { name: "Light" });
    light.focus();
    fireEvent.click(light);
    expect(useApp.getState().themeMode).toBe("light");
    expect(
      within(panel).getByRole("group", { name: "Measurement system" }),
    ).toBeTruthy();
    fireEvent.keyDown(light, { key: "Escape" });
    expect(
      screen.queryByRole("region", { name: "Editor settings" }),
    ).toBeNull();
    expect(document.activeElement).toBe(settings);
  });
});
