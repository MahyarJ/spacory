import type { Point } from "@app/schema";
import type { Bounds } from "@geometry/bounds";

/** Canvas viewport (pan/zoom) state. Deliberately not part of `Plan` or the
 *  undo history — it is persisted on its own (see below). */
export interface ViewState {
  panX: number;
  panY: number;
  scale: number;
  /** Fit can lower the zoom floor until the next Fit. */
  minScale?: number;
}

/** localStorage key under which the viewport is autosaved. */
export const VIEW_STORAGE_KEY = "spacory.view";

/** Bump if the persisted envelope shape changes incompatibly. */
const VIEW_FORMAT = 1;

/** Normal zoom bounds. Fit can frame a labeled plan below MIN_SCALE. */
export const MIN_SCALE = 0.2;
export const MAX_SCALE = 8;

/** The viewport used when nothing valid is persisted. */
export const DEFAULT_VIEW: ViewState = { panX: 0, panY: 0, scale: 1 };

/** Clamp a zoom level into the supported range. */
export function clampScale(scale: number, minScale = MIN_SCALE): number {
  return Math.min(MAX_SCALE, Math.max(minScale, scale));
}

/**
 * Fraction of the canvas left empty on each side when framing content, so the
 * plan doesn't sit flush against the edges. ~5% per side ≈ 10% total margin.
 */
export const FIT_PADDING = 0.05;
const LABEL_DRAFT_INSET = 16;

export type FitInsets = { top: number; bottom: number };

/**
 * Compute the viewport that frames a content bounding box within a canvas of the
 * given pixel size: zoom so the box (plus a small margin) fits, then center it
 * both ways. Pass a lower minimum when Fit must frame a distant label.
 *
 * Pure — no React, no DOM. Returns DEFAULT_VIEW when there is nothing to frame
 * (`bounds` is null, i.e. an empty plan) or the canvas size is degenerate, so the
 * caller resets to the home view rather than producing NaN.
 */
export function computeFitView(
  bounds: Bounds | null,
  viewport: { width: number; height: number },
  padding = FIT_PADDING,
  minScale = MIN_SCALE,
  { top, bottom }: FitInsets = { top: 0, bottom: 0 },
): ViewState {
  if (!bounds || !(viewport.width > 0) || !(viewport.height > 0)) {
    return DEFAULT_VIEW;
  }

  const contentW = bounds.maxX - bounds.minX;
  const contentH = bounds.maxY - bounds.minY;
  const unobstructed = viewport.height - top - bottom;
  const height = unobstructed > 0 ? unobstructed : viewport.height;
  const usableW = viewport.width * (1 - 2 * padding);
  const usableH = height * (1 - 2 * padding);

  // A zero-width or zero-height extent (e.g. a single point) puts no constraint
  // on that axis. If both extents are zero there is nothing to scale to, so we
  // keep the default zoom and just center on the point below.
  const scaleX = contentW > 0 ? usableW / contentW : Number.POSITIVE_INFINITY;
  const scaleY = contentH > 0 ? usableH / contentH : Number.POSITIVE_INFINITY;
  const fit = Math.min(scaleX, scaleY);
  const scale = clampScale(
    fit > 0 && Number.isFinite(fit) ? fit : DEFAULT_VIEW.scale,
    minScale,
  );

  const centerX = (bounds.minX + bounds.maxX) / 2;
  const centerY = (bounds.minY + bounds.maxY) / 2;
  return {
    scale,
    panX: viewport.width / 2 - centerX * scale,
    panY: (unobstructed > 0 ? top : 0) + height / 2 - centerY * scale,
    ...(scale < MIN_SCALE ? { minScale: scale } : {}),
  };
}

/** Reveal world-space draft bounds, following the caret when the line cannot fit. */
export function revealLabelDraft(
  view: ViewState,
  viewport: { width: number; height: number },
  bounds: Bounds,
  caret: Point,
): ViewState {
  if (!(viewport.width > 0 && viewport.height > 0)) return view;

  const shiftToReveal = (
    min: number,
    max: number,
    focus: number,
    size: number,
  ) => {
    const inset = Math.min(LABEL_DRAFT_INSET, size / 4);
    const end = size - inset;
    if (max - min > end - inset) {
      min = focus;
      max = focus;
    }
    if (min < inset) return inset - min;
    if (max > end) return end - max;
    return 0;
  };

  const { panX, panY, scale } = view;
  const dx = shiftToReveal(
    bounds.minX * scale + panX,
    bounds.maxX * scale + panX,
    caret.x * scale + panX,
    viewport.width,
  );
  const dy = shiftToReveal(
    bounds.minY * scale + panY,
    bounds.maxY * scale + panY,
    caret.y * scale + panY,
    viewport.height,
  );
  if (Math.abs(dx) < 1e-6 && Math.abs(dy) < 1e-6) return view;
  return { ...view, panX: panX + dx, panY: panY + dy };
}

/**
 * A pointer position in canvas-local pixels (client coordinates minus the
 * canvas's top-left corner) — the same space `panX`/`panY` live in.
 */
export interface CanvasPoint {
  x: number;
  y: number;
}

/** Keep the world point under the zoom anchor fixed, including at the limits. */
export function zoomView(
  view: ViewState,
  factor: number,
  anchor: CanvasPoint,
): ViewState {
  const scale = clampScale(view.scale * factor, view.minScale);
  const ratio = scale / view.scale;
  return {
    ...view,
    scale,
    panX: anchor.x - (anchor.x - view.panX) * ratio,
    panY: anchor.y - (anchor.y - view.panY) * ratio,
  };
}

/**
 * Where a two-finger gesture started: both contact positions plus the viewport
 * at that moment. Held for the whole gesture so pan and zoom are derived from
 * the anchor rather than accumulated per move, which would drift once the scale
 * clamps.
 */
export interface PinchAnchor {
  a: CanvasPoint;
  b: CanvasPoint;
  view: ViewState;
}

function midpoint(a: CanvasPoint, b: CanvasPoint): CanvasPoint {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

function distance(a: CanvasPoint, b: CanvasPoint): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

/**
 * The viewport for a two-finger gesture, given where the fingers started
 * (`anchor`) and where they are now: zoom by how much they have spread, and pan
 * so the world point that was under the starting midpoint sits under the current
 * midpoint. That single rule covers all three cases the canvas needs —
 * translating both fingers equally pans without zooming, spreading them in place
 * zooms about the midpoint (mirroring how wheel zoom pins the point under the
 * cursor), and doing both at once pans and zooms together.
 *
 * Pure — no React, no DOM. The zoom is clamped to the viewport's zoom limits, and
 * the pan is derived from the *clamped* scale so the midpoint stays anchored
 * even at the limits. Fingers that start on the same spot give no scale
 * reference, so that degenerate case pans without zooming instead of dividing
 * by zero.
 */
export function computePinchView(
  anchor: PinchAnchor,
  a: CanvasPoint,
  b: CanvasPoint,
): ViewState {
  const startDistance = distance(anchor.a, anchor.b);
  const ratio = startDistance > 0 ? distance(a, b) / startDistance : 1;
  const scale = clampScale(anchor.view.scale * ratio, anchor.view.minScale);

  const from = midpoint(anchor.a, anchor.b);
  const to = midpoint(a, b);
  // The world point under the starting midpoint, in the pre-gesture viewport...
  const worldX = (from.x - anchor.view.panX) / anchor.view.scale;
  const worldY = (from.y - anchor.view.panY) / anchor.view.scale;
  // ...has to land under the current midpoint: to = pan + world * scale.
  return {
    ...anchor.view,
    scale,
    panX: to.x - worldX * scale,
    panY: to.y - worldY * scale,
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
 * fails validation. Pan and scale must be finite numbers. Clamp the scale to
 * the zoom limits, preserving a valid lower limit set by Fit.
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
    const { panX, panY, scale, minScale } = raw;
    if (
      !isFiniteNumber(panX) ||
      !isFiniteNumber(panY) ||
      !isFiniteNumber(scale)
    )
      return null;
    const fittedMinimum =
      isFiniteNumber(minScale) && minScale > 0 && minScale < MIN_SCALE
        ? minScale
        : undefined;
    return {
      panX,
      panY,
      scale: clampScale(scale, fittedMinimum),
      ...(fittedMinimum === undefined ? {} : { minScale: fittedMinimum }),
    };
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
