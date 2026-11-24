import type { Operation } from "fast-json-patch";
import type { History } from "./history";
import { coercePlan } from "./io";

/** localStorage key under which the undo history is autosaved. */
export const HISTORY_STORAGE_KEY = "spacory.history";

/** Bump if the persisted envelope shape changes incompatibly. */
const HISTORY_FORMAT = 3;

function getStorage(): Storage | null {
  try {
    // Accessing localStorage can throw (disabled cookies, sandboxed iframes).
    return typeof localStorage !== "undefined" ? localStorage : null;
  } catch {
    return null;
  }
}

/** Accept only well-formed arrays of JSON-Patch operation arrays. */
function asPatchList(value: unknown): Operation[][] {
  if (!Array.isArray(value)) return [];
  return value.every((step) => Array.isArray(step))
    ? (value as Operation[][])
    : [];
}

/**
 * Load the autosaved undo history from localStorage, or null if there is none
 * or it fails validation. `present` is validated via coercePlan, so a corrupt
 * or outdated payload is safely ignored (the app starts fresh). The patch
 * stacks are kept lazily — they're only applied (and thus checked) on undo/redo.
 */
export function loadPersistedHistory(): History | null {
  const storage = getStorage();
  if (!storage) return null;
  let text: string | null;
  try {
    text = storage.getItem(HISTORY_STORAGE_KEY);
  } catch {
    return null;
  }
  if (!text) return null;
  try {
    const raw = JSON.parse(text);
    if (raw?.format !== HISTORY_FORMAT && raw?.format !== 2) return null;
    const past = asPatchList(raw.past);
    const future = asPatchList(raw.future);
    // An old draft's fixture patches refer to free-standing geometry. Loading
    // them after migrating the current plan could recreate invalid fixtures.
    const draftTimeline =
      raw.format === 2 &&
      ((Array.isArray(raw.present?.fixtures) &&
        raw.present.fixtures.length > 0) ||
        [...past, ...future].some((step) =>
          step.some(
            (op) =>
              typeof op?.path === "string" &&
              (op.path === "/fixtures" || op.path.startsWith("/fixtures/")),
          ),
        ));
    return {
      present: coercePlan(raw.present),
      past: draftTimeline ? [] : past,
      future: draftTimeline ? [] : future,
    };
  } catch {
    return null;
  }
}

/**
 * Best-effort write of the undo history to localStorage; never throws.
 * If the full history exceeds the storage quota, falls back to persisting just
 * the current plan so basic autosave still works.
 */
export function savePersistedHistory(history: History): void {
  const storage = getStorage();
  if (!storage) return;
  const write = (h: History) =>
    storage.setItem(
      HISTORY_STORAGE_KEY,
      JSON.stringify({ format: HISTORY_FORMAT, ...h }),
    );
  try {
    write(history);
  } catch {
    try {
      // Quota exceeded: drop undo/redo stacks, keep the current plan.
      write({ past: [], present: history.present, future: [] });
    } catch {
      // Storage genuinely unavailable — autosave is best-effort.
    }
  }
}

/** Remove the autosaved history (e.g. for a future "new document" action). */
export function clearPersistedHistory(): void {
  const storage = getStorage();
  if (!storage) return;
  try {
    storage.removeItem(HISTORY_STORAGE_KEY);
  } catch {
    // ignore
  }
}
