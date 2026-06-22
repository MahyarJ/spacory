import type { Bounds } from "@geometry/bounds";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clampScale,
  computeFitView,
  DEFAULT_VIEW,
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

describe("computeFitView", () => {
  const box = (
    minX: number,
    minY: number,
    maxX: number,
    maxY: number,
  ): Bounds => ({
    minX,
    minY,
    maxX,
    maxY,
  });

  it("resets to DEFAULT_VIEW for an empty plan (null bounds)", () => {
    expect(computeFitView(null, { width: 800, height: 600 })).toEqual(
      DEFAULT_VIEW,
    );
  });

  it("resets to DEFAULT_VIEW for a degenerate canvas size", () => {
    expect(
      computeFitView(box(0, 0, 100, 100), { width: 0, height: 600 }),
    ).toEqual(DEFAULT_VIEW);
    expect(
      computeFitView(box(0, 0, 100, 100), { width: 800, height: 0 }),
    ).toEqual(DEFAULT_VIEW);
  });

  it("fits and centers content within the canvas (no padding)", () => {
    // 100×100 content in a 200×200 canvas → scale 2, centered at the origin.
    const v = computeFitView(
      box(0, 0, 100, 100),
      { width: 200, height: 200 },
      0,
    );
    expect(v.scale).toBe(2);
    expect(v.panX).toBe(0);
    expect(v.panY).toBe(0);
  });

  it("applies the margin so content does not touch the edges", () => {
    const padding = 0.05;
    const v = computeFitView(
      box(0, 0, 100, 50),
      { width: 800, height: 600 },
      padding,
    );
    // Width is the binding dimension: 800 * 0.9 / 100 = 7.2, clamped under MAX.
    expect(v.scale).toBeCloseTo((800 * (1 - 2 * padding)) / 100);
  });

  it("keeps the content centered both ways", () => {
    const bounds = box(40, -60, 240, 140);
    const size = { width: 800, height: 600 };
    const v = computeFitView(bounds, size);
    const centerX = (bounds.minX + bounds.maxX) / 2;
    const centerY = (bounds.minY + bounds.maxY) / 2;
    // World center maps to canvas center: world * scale + pan === size / 2.
    expect(centerX * v.scale + v.panX).toBeCloseTo(size.width / 2);
    expect(centerY * v.scale + v.panY).toBeCloseTo(size.height / 2);
  });

  it("clamps zoom to MAX_SCALE for a tiny plan", () => {
    const v = computeFitView(box(0, 0, 1, 1), { width: 800, height: 600 });
    expect(v.scale).toBe(MAX_SCALE);
  });

  it("clamps zoom to MIN_SCALE for a huge plan", () => {
    const v = computeFitView(box(0, 0, 100000, 100000), {
      width: 800,
      height: 600,
    });
    expect(v.scale).toBe(MIN_SCALE);
  });

  it("produces finite values for a zero-size (single-point) bounds", () => {
    const v = computeFitView(box(50, 50, 50, 50), { width: 800, height: 600 });
    expect(Number.isFinite(v.scale)).toBe(true);
    expect(Number.isFinite(v.panX)).toBe(true);
    expect(Number.isFinite(v.panY)).toBe(true);
    // Nothing to scale to → keep the default zoom and center on the point.
    expect(v.scale).toBe(DEFAULT_VIEW.scale);
    expect(50 * v.scale + v.panX).toBeCloseTo(400);
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
