import { describe, expect, it } from "vitest";
import { PLAN_VERSION, PlanParseError, parsePlan, serializePlan } from "./io";
import {
  createInitialPlan,
  type DoorItem,
  type Plan,
  type WindowItem,
} from "./schema";

const base = createInitialPlan();
const door: DoorItem = {
  id: "door_1",
  type: "door",
  wallAttach: { wallId: "wall_1", offset: 40, length: 80 },
  thickness: 18,
  props: { hingeEdge: "end", swingSide: "inside" },
};
const win: WindowItem = {
  id: "win_1",
  type: "window",
  wallAttach: { wallId: "wall_2", offset: 20, length: 60 },
  thickness: 18,
  props: {},
};
const plan: Plan = {
  ...base,
  meta: { ...base.meta, name: "My Plan", gridSize: 25, units: "m" },
  walls: [
    { id: "wall_1", a: { x: 0, y: 0 }, b: { x: 300, y: 0 }, thickness: 10 },
    { id: "wall_2", a: { x: 300, y: 0 }, b: { x: 300, y: 200 }, thickness: 15 },
  ],
  items: [door, win],
};

describe("serializePlan / parsePlan round-trip", () => {
  it("preserves walls, items and meta through a round-trip", () => {
    const parsed = parsePlan(serializePlan(plan));

    expect(parsed.version).toBe(PLAN_VERSION);
    expect(parsed.walls).toEqual(plan.walls);
    expect(parsed.items).toEqual(plan.items);
    expect(parsed.meta.name).toBe(plan.meta.name);
    expect(parsed.meta.units).toBe(plan.meta.units);
    expect(parsed.meta.gridSize).toBe(plan.meta.gridSize);
    expect(parsed.meta.createdAt).toBe(plan.meta.createdAt);
  });

  it("preserves door props (hingeEdge / swingSide)", () => {
    const parsed = parsePlan(serializePlan(plan));
    const door = parsed.items.find((i) => i.id === "door_1") as DoorItem;
    expect(door.props).toEqual({ hingeEdge: "end", swingSide: "inside" });
  });

  it("refreshes updatedAt to a valid ISO timestamp on import", () => {
    const parsed = parsePlan(serializePlan(plan));
    expect(() => new Date(parsed.meta.updatedAt).toISOString()).not.toThrow();
    expect(Number.isNaN(Date.parse(parsed.meta.updatedAt))).toBe(false);
  });

  it("produces output that survives a second round-trip unchanged (modulo updatedAt)", () => {
    const once = parsePlan(serializePlan(plan));
    const twice = parsePlan(serializePlan(once));
    // parsePlan intentionally refreshes meta.updatedAt on every import, so the
    // two parses can differ by a millisecond — compare everything else.
    const stripTime = (p: Plan): Plan => ({
      ...p,
      meta: { ...p.meta, updatedAt: "" },
    });
    expect(stripTime(twice)).toEqual(stripTime(once));
  });
});

describe("parsePlan normalization", () => {
  it("drops items whose wall no longer exists", () => {
    // Derive a variant without wall_2 (don't mutate the shared fixture);
    // its attached window should be dropped on import.
    const variant: Plan = {
      ...plan,
      walls: plan.walls.filter((w) => w.id !== "wall_2"),
    };
    const parsed = parsePlan(serializePlan(variant));
    expect(parsed.items.map((i) => i.id)).toEqual(["door_1"]);
  });

  it("normalizes an unknown version but keeps the geometry", () => {
    const text = JSON.stringify({
      version: "0.0.1-legacy",
      meta: { name: "Old", units: "cm", gridSize: 20 },
      walls: [{ id: "w", a: { x: 0, y: 0 }, b: { x: 10, y: 0 }, thickness: 8 }],
      items: [],
    });
    const parsed = parsePlan(text);
    expect(parsed.version).toBe(PLAN_VERSION);
    expect(parsed.walls).toHaveLength(1);
  });

  it("falls back to defaults for missing/invalid meta fields", () => {
    const defaults = createInitialPlan();
    const text = JSON.stringify({
      meta: { units: "lightyears", gridSize: -5 },
      walls: [],
      items: [],
    });
    const parsed = parsePlan(text);
    expect(parsed.meta.units).toBe(defaults.meta.units);
    expect(parsed.meta.gridSize).toBe(defaults.meta.gridSize);
    expect(parsed.meta.name).toBe(defaults.meta.name);
  });

  it("defaults door props when they are missing", () => {
    const text = JSON.stringify({
      meta: {},
      walls: [{ id: "w", a: { x: 0, y: 0 }, b: { x: 10, y: 0 }, thickness: 8 }],
      items: [
        {
          id: "d",
          type: "door",
          wallAttach: { wallId: "w", offset: 0, length: 5 },
          thickness: 10,
        },
      ],
    });
    const parsed = parsePlan(text);
    const door = parsed.items[0] as DoorItem;
    expect(door.props).toEqual({ hingeEdge: "start", swingSide: "outside" });
  });
});

describe("parsePlan validation errors", () => {
  const expectError = (text: string, match: RegExp) =>
    expect(() => parsePlan(text)).toThrow(match);

  it("rejects non-JSON input", () => {
    expect(() => parsePlan("{not json")).toThrow(PlanParseError);
    expectError("{not json", /not valid JSON/i);
  });

  it("rejects a non-object root", () => {
    expectError("[]", /must be a JSON object/i);
  });

  it("rejects a plan missing the walls array", () => {
    expectError(JSON.stringify({ items: [] }), /"walls" array/i);
  });

  it("rejects a plan missing the items array", () => {
    expectError(JSON.stringify({ walls: [] }), /"items" array/i);
  });

  it("rejects a wall with non-numeric coordinates", () => {
    const text = JSON.stringify({
      walls: [
        { id: "w", a: { x: "0", y: 0 }, b: { x: 10, y: 0 }, thickness: 8 },
      ],
      items: [],
    });
    expectError(text, /walls\[0\]\.a must be a point/i);
  });

  it("rejects a wall with non-positive thickness", () => {
    const text = JSON.stringify({
      walls: [{ id: "w", a: { x: 0, y: 0 }, b: { x: 10, y: 0 }, thickness: 0 }],
      items: [],
    });
    expectError(text, /thickness must be a positive number/i);
  });

  it("rejects an item with an unknown type", () => {
    const text = JSON.stringify({
      walls: [{ id: "w", a: { x: 0, y: 0 }, b: { x: 10, y: 0 }, thickness: 8 }],
      items: [
        {
          id: "x",
          type: "skylight",
          wallAttach: { wallId: "w", offset: 0, length: 5 },
          thickness: 10,
        },
      ],
    });
    expectError(text, /must be "door" or "window"/i);
  });
});
