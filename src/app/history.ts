import { applyPatch, compare, type Operation } from "fast-json-patch";
import type { Plan } from "./schema";

/**
 * Diff-based undo history. Instead of full plan snapshots, each step stores a
 * JSON Patch (RFC 6902):
 *   - `past[i]`   transforms the state *into its predecessor* (apply to undo)
 *   - `future[i]` transforms the state *into its successor*   (apply to redo)
 * Only `present` is held in full. This keeps history small enough to persist
 * many steps cheaply.
 */
export interface History {
  past: Operation[][];
  present: Plan;
  future: Operation[][];
}

/**
 * Max retained undo steps. Diffs are tiny, so this is generous — it exists only
 * as a backstop against unbounded growth (memory + localStorage quota), not as
 * a typical limit users would hit.
 */
export const MAX_STEPS = 500;

export const createHistory = (present: Plan): History => ({
  past: [],
  present,
  future: [],
});

export const canUndo = (h: History): boolean => h.past.length > 0;
export const canRedo = (h: History): boolean => h.future.length > 0;

/** Apply a patch to a copy of `plan` (never mutates the input). */
function patched(plan: Plan, ops: Operation[]): Plan {
  // mutateDocument=false → fast-json-patch clones internally and returns a new doc.
  return applyPatch(plan, ops, false, false).newDocument;
}

/** Record a new committed state, clearing the redo stack. */
export function commit(h: History, next: Plan): History {
  const undoPatch = compare(next, h.present); // next -> present
  const past = [...h.past, undoPatch];
  while (past.length > MAX_STEPS) past.shift();
  return { past, present: next, future: [] };
}

/** Step back one state. Returns the history unchanged if nothing to undo. */
export function undo(h: History): History {
  if (!h.past.length) return h;
  const past = h.past.slice();
  const undoPatch = past.pop() as Operation[];
  try {
    const previous = patched(h.present, undoPatch);
    const redoPatch = compare(previous, h.present); // previous -> present
    return { past, present: previous, future: [...h.future, redoPatch] };
  } catch {
    // Corrupt patch (e.g. tampered persisted data): drop the undo stack.
    return { ...h, past: [] };
  }
}

/** Step forward one state. Returns the history unchanged if nothing to redo. */
export function redo(h: History): History {
  if (!h.future.length) return h;
  const future = h.future.slice();
  const redoPatch = future.pop() as Operation[];
  try {
    const next = patched(h.present, redoPatch);
    const undoPatch = compare(next, h.present); // next -> present
    return { past: [...h.past, undoPatch], present: next, future };
  } catch {
    return { ...h, future: [] };
  }
}
