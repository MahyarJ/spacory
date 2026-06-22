import type { Bounds } from "@geometry/bounds";

/** Canvas viewport (pan/zoom) state. Deliberately not part of `Plan` or the
 *  undo history — it is persisted on its own (see below). */
export interface ViewState {
  panX: number;
  panY: number;
  scale: number;
}

/** localStorage key under which the viewport is autosaved. */
export const VIEW_STORAGE_KEY = "spacory.view";

/** Bump if the persisted envelope shape changes incompatibly. */
const VIEW_FORMAT = 1;

/** Zoom bounds — kept in sync with the clamp in `onWheel` (FloorPlan.tsx). */
export const MIN_SCALE = 0.2;
export const MAX_SCALE = 8;

/** The viewport used when nothing valid is persisted. */
export const DEFAULT_VIEW: ViewState = { panX: 0, panY: 0, scale: 1 };

/** Clamp a zoom level into the supported range. */
export function clampScale(scale: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
}

/**
 * Fraction of the canvas left empty on each side when framing content, so the
 * plan doesn't sit flush against the edges. ~5% per side ≈ 10% total margin.
 */
export const FIT_PADDING = 0.05;

/**
 * Compute the viewport that frames a content bounding box within a canvas of the
 * given pixel size: zoom so the box (plus a small margin) fits, then center it
 * both ways. The zoom is clamped to [MIN_SCALE, MAX_SCALE], so a tiny plan never
 * zooms past MAX_SCALE and a huge one never past MIN_SCALE.
 *
 * Pure — no React, no DOM. Returns DEFAULT_VIEW when there is nothing to frame
 * (`bounds` is null, i.e. an empty plan) or the canvas size is degenerate, so the
 * caller resets to the home view rather than producing NaN.
 */
export function computeFitView(
  bounds: Bounds | null,
  viewport: { width: number; height: number },
  padding = FIT_PADDING,
): ViewState {
  if (!bounds || !(viewport.width > 0) || !(viewport.height > 0)) {
    return DEFAULT_VIEW;
  }

  const contentW = bounds.maxX - bounds.minX;
  const contentH = bounds.maxY - bounds.minY;
  const usableW = viewport.width * (1 - 2 * padding);
  const usableH = viewport.height * (1 - 2 * padding);

  // A zero-width or zero-height extent (e.g. a single point) puts no constraint
  // on that axis. If both extents are zero there is nothing to scale to, so we
  // keep the default zoom and just center on the point below.
  const scaleX = contentW > 0 ? usableW / contentW : Number.POSITIVE_INFINITY;
  const scaleY = contentH > 0 ? usableH / contentH : Number.POSITIVE_INFINITY;
  const fit = Math.min(scaleX, scaleY);
  const scale = clampScale(Number.isFinite(fit) ? fit : DEFAULT_VIEW.scale);

  const centerX = (bounds.minX + bounds.maxX) / 2;
  const centerY = (bounds.minY + bounds.maxY) / 2;
  return {
    scale,
    panX: viewport.width / 2 - centerX * scale,
    panY: viewport.height / 2 - centerY * scale,
  };
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function getStorage(): Storage | null {
  try {
    // Accessing localStorage can throw (disabled cookies, sandboxed iframes).
    return typeof localStorage !== "undefined" ? localStorage : null;
  } catch {
    return null;
  }
}

/**
 * Load the persisted viewport from localStorage, or null if there is none or it
 * fails validation. `panX`/`panY`/`scale` must be finite numbers; `scale` is
 * clamped into [MIN_SCALE, MAX_SCALE] rather than rejected, so an out-of-range
 * zoom is corrected instead of crashing or discarding the saved pan. Anything
 * else (missing values, corrupt JSON, unknown format) yields null and the
 * caller falls back to DEFAULT_VIEW.
 */
export function loadPersistedView(): ViewState | null {
  const storage = getStorage();
  if (!storage) return null;
  let text: string | null;
  try {
    text = storage.getItem(VIEW_STORAGE_KEY);
  } catch {
    return null;
  }
  if (!text) return null;
  try {
    const raw = JSON.parse(text);
    if (raw?.format !== VIEW_FORMAT) return null;
    const { panX, panY, scale } = raw;
    if (
      !isFiniteNumber(panX) ||
      !isFiniteNumber(panY) ||
      !isFiniteNumber(scale)
    )
      return null;
    return { panX, panY, scale: clampScale(scale) };
  } catch {
    return null;
  }
}

/** Best-effort write of the viewport to localStorage; never throws. */
export function savePersistedView(view: ViewState): void {
  const storage = getStorage();
  if (!storage) return;
  try {
    storage.setItem(
      VIEW_STORAGE_KEY,
      JSON.stringify({ format: VIEW_FORMAT, ...view }),
    );
  } catch {
    // Storage unavailable or over quota — viewport persistence is best-effort.
  }
}
