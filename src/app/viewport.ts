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
