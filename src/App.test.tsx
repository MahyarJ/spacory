// @vitest-environment jsdom
import { createInitialPlan } from "@app/schema";
import { useApp } from "@app/store";
import { DEFAULT_VIEW } from "@app/viewport";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import App from "./App";

describe("App shell", () => {
  beforeEach(() => {
    const state = useApp.getState();
    state.loadPlan(createInitialPlan());
    state.setView(() => DEFAULT_VIEW);
    state.setTool("select");
    state.setThemeMode("system");
  });

  afterEach(() => {
    cleanup();
    localStorage.clear();
  });

  it("keeps drawing, project, history and view controls available", () => {
    render(<App />);

    const tools = within(screen.getByRole("group", { name: "Drawing tools" }));
    for (const name of [
      "Select",
      "Wall",
      "Door",
      "Window",
      "Sink",
      "Fixtures",
    ]) {
      expect(tools.getByRole("button", { name })).toBeTruthy();
    }
    const project = within(
      screen.getByRole("group", { name: "Project actions" }),
    );
    for (const name of ["Import", "Export", "Settings"]) {
      expect(project.getByRole("button", { name })).toBeTruthy();
    }
    const history = within(screen.getByRole("group", { name: "Edit history" }));
    expect(history.getByRole("button", { name: "Undo" })).toBeTruthy();
    expect(history.getByRole("button", { name: "Redo" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Spacory" }).textContent).toBe(
      "S",
    );
  });

  it("shows the zoom percentage and only displays the current drawing hint", () => {
    render(<App />);

    const viewport = within(screen.getByRole("group", { name: "Canvas view" }));
    expect(viewport.getByText("100%")).toBeTruthy();
    fireEvent.click(viewport.getByRole("button", { name: "Zoom in" }));
    expect(viewport.getByText("125%")).toBeTruthy();
    fireEvent.click(viewport.getByRole("button", { name: "Zoom out" }));
    expect(viewport.getByText("100%")).toBeTruthy();
    expect(
      viewport.getByRole("button", { name: "Fit plan in view" }),
    ).toBeTruthy();
    expect(
      screen.queryByText(/right-drag to pan|wheel to zoom|Tool:.*Scale:/i),
    ).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Door" }));
    expect(screen.getByText(/along a wall to add a door/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Select" }));
    expect(screen.queryByText(/along a wall to add a door/)).toBeNull();
  });

  it("lets the fixture icon and the chevron act independently", () => {
    render(<App />);

    const sink = screen.getByRole("button", { name: "Sink" });
    const fixtures = screen.getByRole("button", { name: "Fixtures" });
    fireEvent.click(sink);
    expect(useApp.getState().tool).toBe("sink");
    expect(sink.getAttribute("aria-pressed")).toBe("true");
    expect(screen.queryByRole("menu")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Select" }));
    expect(sink.getAttribute("aria-pressed")).toBe("false");
    fixtures.focus();
    fireEvent.keyDown(fixtures, { key: "ArrowDown" });
    const option = screen.getByRole("menuitemradio", {
      name: "Sink",
      checked: true,
    });
    expect(document.activeElement).toBe(option);
    expect(useApp.getState().tool).toBe("select");
    fireEvent.click(option);
    expect(document.activeElement).toBe(fixtures);
    expect(useApp.getState().tool).toBe("sink");
    expect(sink.getAttribute("aria-pressed")).toBe("true");
  });

  it("exposes preferences through Settings and returns focus on Escape", () => {
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
