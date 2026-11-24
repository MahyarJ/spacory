import type { Operation } from "fast-json-patch";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { commit, createHistory, type History, redo, undo } from "./history";
import {
  clearPersistedHistory,
  HISTORY_STORAGE_KEY,
  loadPersistedHistory,
  savePersistedHistory,
} from "./persistence";
import { createInitialPlan, type Plan } from "./schema";

/** Minimal in-memory localStorage stand-in for the node test environment. */
function makeStorage(overrides: Partial<Storage> = {}): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (k) => map.get(k) ?? null,
    key: (i) => [...map.keys()][i] ?? null,
    removeItem: (k) => map.delete(k),
    setItem: (k, v) => {
      map.set(k, v);
    },
    ...overrides,
  };
}

function planNamed(name: string, wallX: number): Plan {
  const base = createInitialPlan();
  return {
    ...base,
    meta: { ...base.meta, name },
    walls: [
      { id: "w1", a: { x: 0, y: 0 }, b: { x: wallX, y: 0 }, thickness: 10 },
    ],
    items: [],
  };
}

const undoPatch: Operation[] = [
  { op: "replace", path: "/walls/0/b/x", value: 100 },
];
const redoPatch: Operation[] = [
  { op: "replace", path: "/walls/0/b/x", value: 300 },
];

function sampleHistory(): History {
  return {
    past: [undoPatch],
    present: planNamed("current", 200),
    future: [redoPatch],
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("savePersistedHistory / loadPersistedHistory", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", makeStorage());
  });

  it("round-trips present plan and patch stacks", () => {
    savePersistedHistory(sampleHistory());
    const loaded = loadPersistedHistory();

    expect(loaded?.present.meta.name).toBe("current");
    expect(loaded?.present.walls).toEqual(sampleHistory().present.walls);
    expect(loaded?.past).toEqual([undoPatch]);
    expect(loaded?.future).toEqual([redoPatch]);
  });

  it("writes under the documented key", () => {
    savePersistedHistory(sampleHistory());
    expect(localStorage.getItem(HISTORY_STORAGE_KEY)).not.toBeNull();
  });

  it("returns null when nothing is stored", () => {
    expect(loadPersistedHistory()).toBeNull();
  });

  it("returns null for a corrupt payload", () => {
    localStorage.setItem(HISTORY_STORAGE_KEY, "{ not json");
    expect(loadPersistedHistory()).toBeNull();
  });

  it("returns null for an unknown format version", () => {
    localStorage.setItem(
      HISTORY_STORAGE_KEY,
      JSON.stringify({ format: 1, past: [], present: {}, future: [] }),
    );
    expect(loadPersistedHistory()).toBeNull();
  });

  it("drops malformed patch stacks but keeps a valid present", () => {
    localStorage.setItem(
      HISTORY_STORAGE_KEY,
      JSON.stringify({
        format: 2,
        past: "not-an-array",
        present: planNamed("kept", 50),
        future: [{ not: "a patch array" }],
      }),
    );
    const loaded = loadPersistedHistory();
    expect(loaded?.present.meta.name).toBe("kept");
    expect(loaded?.past).toEqual([]);
    expect(loaded?.future).toEqual([]);
  });

  it("migrates an earlier sink draft without restoring its obsolete patches", () => {
    const previewSink = {
      id: "draft",
      type: "sink",
      width: 60,
      depth: 50,
      rotation: 45,
      position: { x: 100, y: 20 },
    };
    const present = planNamed("kept", 200);
    localStorage.setItem(
      HISTORY_STORAGE_KEY,
      JSON.stringify({
        format: 2,
        present: { ...present, fixtures: [previewSink] },
        past: [[{ op: "remove", path: "/fixtures" }]],
        future: [[{ op: "replace", path: "/fixtures/0/rotation", value: 90 }]],
      }),
    );
    const restored = loadPersistedHistory();
    expect(restored?.present.walls).toEqual(present.walls);
    expect(restored?.present.fixtures).toEqual([
      {
        id: "draft",
        type: "sink",
        wallAttach: { wallId: "w1", offset: 70, length: 60 },
        side: 1,
        depth: 50,
      },
    ]);
    expect(restored?.past).toEqual([]);
    expect(restored?.future).toEqual([]);

    localStorage.setItem(
      HISTORY_STORAGE_KEY,
      JSON.stringify({
        format: 2,
        ...sampleHistory(),
      }),
    );
    expect(loadPersistedHistory()?.past).toEqual([undoPatch]);
    expect(loadPersistedHistory()?.future).toEqual([redoPatch]);
  });

  it("clears the stored history", () => {
    savePersistedHistory(sampleHistory());
    clearPersistedHistory();
    expect(loadPersistedHistory()).toBeNull();
  });
});

describe("graceful degradation", () => {
  it("does nothing and returns null when localStorage is unavailable", () => {
    vi.stubGlobal("localStorage", undefined);
    expect(() => savePersistedHistory(sampleHistory())).not.toThrow();
    expect(loadPersistedHistory()).toBeNull();
  });

  it("falls back to present-only when the full history exceeds quota", () => {
    // setItem throws on the first (full) write, succeeds on the fallback.
    const map = new Map<string, string>();
    let calls = 0;
    vi.stubGlobal(
      "localStorage",
      makeStorage({
        setItem: (k, v) => {
          calls += 1;
          if (calls === 1) throw new Error("QuotaExceededError");
          map.set(k, v);
        },
        getItem: (k) => map.get(k) ?? null,
      }),
    );

    expect(() => savePersistedHistory(sampleHistory())).not.toThrow();
    expect(calls).toBe(2); // full write failed, fallback write succeeded

    const loaded = loadPersistedHistory();
    expect(loaded?.present.meta.name).toBe("current"); // current plan kept
    expect(loaded?.past).toEqual([]); // undo/redo stacks dropped
    expect(loaded?.future).toEqual([]);
  });
});

it("keeps the measurement-system timeline usable after a refresh", () => {
  vi.stubGlobal("localStorage", makeStorage());
  const metric = planNamed("systems", 250.123);
  const imperial: Plan = {
    ...metric,
    meta: { ...metric.meta, measurementSystem: "imperial" },
  };
  savePersistedHistory(commit(createHistory(metric), imperial));
  const refreshed = loadPersistedHistory()!;
  expect(refreshed.present.meta.measurementSystem).toBe("imperial");
  const undone = undo(refreshed);
  expect(undone.present.meta.measurementSystem).toBe("metric");
  expect(undone.present.walls).toEqual(metric.walls);
  expect(redo(undone).present.meta.measurementSystem).toBe("imperial");
});
