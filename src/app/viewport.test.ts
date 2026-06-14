import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clampScale,
  loadPersistedView,
  MAX_SCALE,
  MIN_SCALE,
  savePersistedView,
  VIEW_STORAGE_KEY,
  type ViewState,
} from "./viewport";

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

const sampleView: ViewState = { panX: -120, panY: 45, scale: 2.5 };

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("clampScale", () => {
  it("leaves in-range values untouched", () => {
    expect(clampScale(1)).toBe(1);
    expect(clampScale(MIN_SCALE)).toBe(MIN_SCALE);
    expect(clampScale(MAX_SCALE)).toBe(MAX_SCALE);
  });

  it("clamps below the minimum and above the maximum", () => {
    expect(clampScale(0)).toBe(MIN_SCALE);
    expect(clampScale(1000)).toBe(MAX_SCALE);
  });
});

describe("savePersistedView / loadPersistedView", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", makeStorage());
  });

  it("round-trips pan and zoom", () => {
    savePersistedView(sampleView);
    expect(loadPersistedView()).toEqual(sampleView);
  });

  it("writes under the documented key", () => {
    savePersistedView(sampleView);
    expect(localStorage.getItem(VIEW_STORAGE_KEY)).not.toBeNull();
  });

  it("returns null when nothing is stored", () => {
    expect(loadPersistedView()).toBeNull();
  });

  it("returns null for corrupt JSON", () => {
    localStorage.setItem(VIEW_STORAGE_KEY, "{ not json");
    expect(loadPersistedView()).toBeNull();
  });

  it("returns null for an unknown format version", () => {
    localStorage.setItem(
      VIEW_STORAGE_KEY,
      JSON.stringify({ format: 999, panX: 0, panY: 0, scale: 1 }),
    );
    expect(loadPersistedView()).toBeNull();
  });

  it("returns null when a coordinate is missing or non-numeric", () => {
    localStorage.setItem(
      VIEW_STORAGE_KEY,
      JSON.stringify({ format: 1, panX: 10, scale: 1 }),
    );
    expect(loadPersistedView()).toBeNull();

    localStorage.setItem(
      VIEW_STORAGE_KEY,
      JSON.stringify({ format: 1, panX: 10, panY: "nope", scale: 1 }),
    );
    expect(loadPersistedView()).toBeNull();
  });

  it("returns null when a coordinate is null (non-finite after parse)", () => {
    localStorage.setItem(
      VIEW_STORAGE_KEY,
      '{"format":1,"panX":0,"panY":0,"scale":null}',
    );
    expect(loadPersistedView()).toBeNull();
  });

  it("clamps an out-of-range scale instead of discarding the viewport", () => {
    savePersistedView({ panX: 5, panY: 6, scale: 50 });
    expect(loadPersistedView()).toEqual({ panX: 5, panY: 6, scale: MAX_SCALE });

    savePersistedView({ panX: 5, panY: 6, scale: 0.001 });
    expect(loadPersistedView()).toEqual({ panX: 5, panY: 6, scale: MIN_SCALE });
  });
});

describe("graceful degradation", () => {
  it("does nothing and returns null when localStorage is unavailable", () => {
    vi.stubGlobal("localStorage", undefined);
    expect(() => savePersistedView(sampleView)).not.toThrow();
    expect(loadPersistedView()).toBeNull();
  });

  it("swallows quota errors on save", () => {
    vi.stubGlobal(
      "localStorage",
      makeStorage({
        setItem: () => {
          throw new Error("QuotaExceededError");
        },
      }),
    );
    expect(() => savePersistedView(sampleView)).not.toThrow();
  });
});
