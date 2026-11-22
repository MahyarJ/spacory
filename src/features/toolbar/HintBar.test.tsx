// @vitest-environment jsdom
import { createInitialPlan } from "@app/schema";
import { useApp } from "@app/store";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { HintBar } from "./HintBar";

afterEach(() => {
  cleanup();
  localStorage.clear();
});

it("shows thickness for wall-only selections and Delete for label selections", () => {
  const state = useApp.getState;
  state().loadPlan({
    ...createInitialPlan(),
    walls: ["w1", "w2"].map((id, index) => ({
      id,
      a: { x: 0, y: index * 100 },
      b: { x: 250, y: index * 100 },
      thickness: 10,
    })),
    labels: [
      { id: "l1", text: "Kitchen", position: { x: 40, y: 50 } },
      { id: "l2", text: "Terrace", position: { x: 80, y: 160 } },
    ],
  });
  state().setTool("select");
  state().selectWall("w1");
  const { container } = render(<HintBar />);
  expect(container.textContent).toContain("adjust wall thickness");

  act(() => state().selectWall("w2", true));
  expect(container.textContent).toContain("adjust wall thickness");
  expect(screen.getByText("Delete", { selector: "kbd" })).toBeTruthy();

  act(() => {
    state().selectWall("w1");
    state().selectLabels(["l1"], true);
  });
  expect(container.textContent).not.toContain("adjust wall thickness");
  expect(screen.getByText("Delete", { selector: "kbd" })).toBeTruthy();

  act(() => state().selectLabels(["l1"]));
  expect(container.textContent).toContain("Click or tap again to edit");
  expect(screen.getByText("Delete", { selector: "kbd" })).toBeTruthy();

  act(() => state().selectLabels(["l1", "l2"]));
  expect(container.textContent).not.toContain("Click or tap again to edit");
  expect(screen.getByText("Delete", { selector: "kbd" })).toBeTruthy();
});
