import {
  createInitialPlan,
  type DoorItem,
  type Item,
  type Plan,
  type Wall,
  type WindowItem,
} from "@app/schema";
import { describe, expect, it } from "vitest";
import { selectionActions } from "./selection";

const wall = (id: string): Wall => ({
  id,
  a: { x: 0, y: 0 },
  b: { x: 250, y: 0 },
  thickness: 10,
});

const door = (id: string): DoorItem => ({
  id,
  type: "door",
  thickness: 10,
  wallAttach: { wallId: "w1", offset: 40, length: 80 },
  props: { hingeEdge: "start", swingSide: "outside" },
});

const window_ = (id: string): WindowItem => ({
  id,
  type: "window",
  thickness: 10,
  wallAttach: { wallId: "w1", offset: 140, length: 80 },
  props: {},
});

/** A realistic plan: two walls plus whatever openings a case needs. */
const planWith = (items: Item[] = []): Plan => ({
  ...createInitialPlan(),
  walls: [wall("w1"), wall("w2")],
  items,
});

describe("selectionActions", () => {
  it("offers nothing when nothing is selected", () => {
    expect(selectionActions(planWith(), new Set(), new Set())).toEqual([]);
  });

  it("offers remove for a single selected wall", () => {
    expect(selectionActions(planWith(), new Set(["w1"]), new Set())).toEqual([
      "remove",
    ]);
  });

  it("offers remove for several selected walls", () => {
    expect(
      selectionActions(planWith(), new Set(["w1", "w2"]), new Set()),
    ).toEqual(["remove"]);
  });

  it("offers remove but no hinge/swing for a selected window", () => {
    const plan = planWith([window_("i1")]);
    expect(selectionActions(plan, new Set(), new Set(["i1"]))).toEqual([
      "remove",
    ]);
  });

  it("offers remove, hinge and swing for a selected door", () => {
    const plan = planWith([door("i1")]);
    expect(selectionActions(plan, new Set(), new Set(["i1"]))).toEqual([
      "remove",
      "hinge",
      "swing",
    ]);
  });

  it("offers hinge and swing for a mixed wall + door selection", () => {
    const plan = planWith([door("i1")]);
    expect(selectionActions(plan, new Set(["w1"]), new Set(["i1"]))).toEqual([
      "remove",
      "hinge",
      "swing",
    ]);
  });

  it("ignores doors that are not part of the selection", () => {
    const plan = planWith([door("i1"), window_("i2")]);
    expect(selectionActions(plan, new Set(), new Set(["i2"]))).toEqual([
      "remove",
    ]);
  });
});
