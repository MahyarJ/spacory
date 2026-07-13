import { getPlanBounds } from "@geometry/bounds";
import {
  getConnectionPoints,
  pointsEqual,
  translateEndpointsAt,
} from "@geometry/connectivity";
import { reconcileItemsToWalls } from "@geometry/itemGeometry";
import { MIN_WALL_LENGTH, resizeWallToLength } from "@geometry/wall";
import { create } from "zustand";
import { throttle } from "../util/throttle";
import {
  commit as commitHistory,
  createHistory,
  type History,
  redo as redoHistory,
  undo as undoHistory,
} from "./history";
import { loadPersistedHistory, savePersistedHistory } from "./persistence";
import {
  createInitialPlan,
  type Item,
  isDoor,
  type Plan,
  type Point,
  type Wall,
} from "./schema";
import {
  applyThemeAttr,
  initialTheme,
  THEME_KEY,
  type ThemeMode,
} from "./theming";
import {
  computeFitView,
  DEFAULT_VIEW,
  loadPersistedView,
  savePersistedView,
  type ViewState,
} from "./viewport";

export type Tool = "select" | "wall" | "window" | "door" | "pan";

interface AppState {
  plan: Plan;
  tool: Tool;
  view: ViewState;
  /** Canvas size in CSS pixels, mirrored from the SVG element (FloorPlan). */
  canvasSize: { width: number; height: number };
  isPanning: boolean;
  setTool: (t: Tool) => void;
  addWall: (w: Wall) => void;
  addItem: (i: Item) => void;
  setView: (fn: (v: ViewState) => ViewState) => void;
  setCanvasSize: (size: { width: number; height: number }) => void;
  /**
   * Frame the whole plan in the canvas (centered, with a small margin and the
   * zoom clamped to the scale bounds), or reset to DEFAULT_VIEW when the plan is
   * empty. Routed through `setView` so the result autosaves like any pan/zoom.
   */
  fitView: () => void;
  setIsPanning: (p: boolean) => void;
  currentWallThickness: number;
  setCurrentWallThickness: (t: number) => void;
  selectedWalls: Set<string>;
  selectedItems: Set<string>;
  /** The single connection point (shared wall-endpoint coordinate) currently selected. */
  selectedConnectionPoint: Point | null;
  selectNone: () => void;
  selectWall: (id: string, additive?: boolean) => void;
  selectItem: (id: string, additive?: boolean) => void;
  selectConnectionPoint: (point: Point) => void;
  deleteSelected: () => void;
  nudgeSelectedWallThickness: (delta: number) => void;
  /**
   * Resize the single selected wall to an exact length (cm), anchoring `a` and
   * moving `b` along the wall's direction. No-ops unless exactly one wall is
   * selected and `length` is a finite value ≥ MIN_WALL_LENGTH.
   */
  setSelectedWallLength: (length: number) => void;
  toggleSelectedDoorHingeEdge: () => void;
  toggleSelectedDoorSwingSide: () => void;
  themeMode: ThemeMode;
  setThemeMode: (m: ThemeMode) => void;
  undo: () => void;
  redo: () => void;
  marquee?: { x0: number; y0: number; x1: number; y1: number } | null;
  setMarquee: (m: AppState["marquee"]) => void;
  /** Replace the whole plan (e.g. on import); resets undo history and selection. */
  loadPlan: (p: Plan) => void;
  translateSelectedWalls: (dx: number, dy: number) => void;
  /** Move selected walls without writing to history (live drag preview). */
  translateSelectedWallsLive: (dx: number, dy: number) => void;
  /**
   * Move every wall endpoint at the selected connection point, committing a
   * single undo step (used for arrow-key nudge).
   */
  translateSelectedConnectionPoint: (dx: number, dy: number) => void;
  /** Same, but without writing to history (live drag preview). */
  translateSelectedConnectionPointLive: (dx: number, dy: number) => void;
  /** Push the current plan onto the undo stack as a single history entry. */
  commitPlan: () => void;
}

// Diff-based undo history (see history.ts). Rehydrate the autosaved history on
// startup; else start fresh. Reassigned wholesale on each mutation.
let history: History =
  loadPersistedHistory() ?? createHistory(createInitialPlan());

/** Autosave the whole undo/redo history after every history mutation. */
function persist() {
  savePersistedHistory(history);
}

function commit(next: Plan) {
  // Reconcile door/window openings against their wall's current length here so
  // every wall-resize path (type-to-length, connection-point drag, auto-follow)
  // is covered without touching each call site individually.
  const reconciled: Plan = {
    ...next,
    items: reconcileItemsToWalls(next.walls, next.items),
  };
  history = commitHistory(history, reconciled);
  persist();
}

// Throttle viewport autosave so continuous wheel/drag stays smooth while still
// persisting the resting position. Separate from the history autosave above —
// the viewport is not part of the Plan or the undo history.
const saveView = throttle(savePersistedView, 200);

/**
 * Move the selected walls by (dx, dy), and every other wall endpoint joined to
 * one of their (pre-move) endpoints along with them, so junctions stay intact.
 * Only the immediate endpoint is followed — no cascading further through the
 * connectivity graph.
 */
function translateSelectedWallsFollowing(
  walls: Wall[],
  selectedWalls: Set<string>,
  dx: number,
  dy: number,
): Wall[] {
  if (dx === 0 && dy === 0) return walls;
  const movedPoints = getConnectionPoints(
    walls.filter((w) => selectedWalls.has(w.id)),
  );
  // Decide every wall's new endpoints against the pre-move `walls` array in one
  // pass, rather than reducing wall-by-wall — otherwise an earlier point's move
  // can shift a coordinate onto a later movedPoint (e.g. a wall translated by
  // exactly its own length), causing that point to match and move again.
  return walls.map((w) => {
    const atA = movedPoints.some((p) => pointsEqual(p, w.a));
    const atB = movedPoints.some((p) => pointsEqual(p, w.b));
    if (!atA && !atB) return w;
    return {
      ...w,
      a: atA ? { x: w.a.x + dx, y: w.a.y + dy } : w.a,
      b: atB ? { x: w.b.x + dx, y: w.b.y + dy } : w.b,
    };
  });
}

export const useApp = create<AppState>((set, get) => ({
  plan: history.present,
  tool: "wall",
  view: loadPersistedView() ?? DEFAULT_VIEW,
  canvasSize: { width: 800, height: 600 },
  isPanning: false,
  setTool: (t) => set({ tool: t }),
  currentWallThickness: 10, // cm default
  setCurrentWallThickness: (t) => set({ currentWallThickness: Math.max(1, t) }),
  selectedWalls: new Set(),
  selectedItems: new Set(),
  selectedConnectionPoint: null,
  addWall: (w) => {
    const next: Plan = {
      ...get().plan,
      walls: [...get().plan.walls, w],
      meta: { ...get().plan.meta, updatedAt: new Date().toISOString() },
    };
    commit(next);
    set({ plan: history.present });
  },
  addItem: (i) => {
    const next: Plan = {
      ...get().plan,
      items: [...get().plan.items, i],
      meta: { ...get().plan.meta, updatedAt: new Date().toISOString() },
    };
    commit(next);
    set({ plan: history.present });
  },
  setView: (fn) =>
    set(({ view }) => {
      const next = fn(view);
      saveView(next);
      return { view: next };
    }),
  setCanvasSize: (size) =>
    set(({ canvasSize }) =>
      size.width === canvasSize.width && size.height === canvasSize.height
        ? {}
        : { canvasSize: size },
    ),
  fitView: () => {
    const { plan, canvasSize, setView } = get();
    const next = computeFitView(getPlanBounds(plan), canvasSize);
    setView(() => next);
  },
  setIsPanning: (p) => set({ isPanning: p }),
  selectNone: () =>
    set({
      selectedWalls: new Set(),
      selectedItems: new Set(),
      selectedConnectionPoint: null,
    }),
  selectWall: (id, additive) =>
    set((s) => {
      const ws = additive ? new Set(s.selectedWalls) : new Set<string>();
      ws.add(id);
      return {
        selectedWalls: ws,
        selectedItems: additive ? s.selectedItems : new Set(),
        selectedConnectionPoint: null,
      };
    }),
  selectItem: (id, additive) =>
    set((s) => {
      const is = additive ? new Set(s.selectedItems) : new Set<string>();
      is.add(id);
      return {
        selectedItems: is,
        selectedWalls: additive ? s.selectedWalls : new Set(),
        selectedConnectionPoint: null,
      };
    }),
  selectConnectionPoint: (point) =>
    set({
      selectedConnectionPoint: point,
      selectedWalls: new Set(),
      selectedItems: new Set(),
    }),
  deleteSelected: () => {
    const { selectedWalls, selectedItems, plan } = get();
    if (selectedWalls.size === 0 && selectedItems.size === 0) return;
    const next: Plan = {
      ...plan,
      walls: plan.walls.filter((w) => !selectedWalls.has(w.id)),
      items: plan.items.filter((i) => !selectedItems.has(i.id)),
      meta: { ...plan.meta, updatedAt: new Date().toISOString() },
    };
    commit(next);
    set({
      plan: history.present,
      selectedWalls: new Set(),
      selectedItems: new Set(),
    });
  },
  nudgeSelectedWallThickness: (delta) => {
    const { selectedWalls, plan } = get();
    if (!selectedWalls.size) return;
    const next: Plan = {
      ...plan,
      walls: plan.walls.map((w) =>
        selectedWalls.has(w.id)
          ? {
              ...w,
              thickness: Math.max(1, Math.round(w.thickness + delta)),
            }
          : w,
      ),
      meta: { ...plan.meta, updatedAt: new Date().toISOString() },
    };
    commit(next);
    set({ plan: history.present });
  },
  setSelectedWallLength: (length) => {
    const { selectedWalls, plan } = get();
    if (selectedWalls.size !== 1) return;
    if (!Number.isFinite(length) || length < MIN_WALL_LENGTH) return;
    const [id] = selectedWalls;
    const wall = plan.walls.find((w) => w.id === id);
    if (!wall) return;
    const resized = resizeWallToLength(wall, length);
    // Skip a no-op resize so we don't push an empty undo step.
    if (resized.b.x === wall.b.x && resized.b.y === wall.b.y) return;
    const dx = resized.b.x - wall.b.x;
    const dy = resized.b.y - wall.b.y;
    const resizedWalls = plan.walls.map((w) => (w.id === id ? resized : w));
    // `a` stays put on a resize; only `b` moved, so only walls joined there follow.
    const next: Plan = {
      ...plan,
      walls: translateEndpointsAt(resizedWalls, wall.b, dx, dy),
      meta: { ...plan.meta, updatedAt: new Date().toISOString() },
    };
    commit(next);
    set({ plan: history.present });
  },
  toggleSelectedDoorHingeEdge: () => {
    const { plan, selectedItems } = get();
    const next: Plan = {
      ...plan,
      items: plan.items.map((i) => {
        if (isDoor(i) && selectedItems.has(i.id)) {
          const cur = i.props ?? { hingeEdge: "start", swingSide: "outside" };
          return {
            ...i,
            props: {
              ...cur,
              hingeEdge: cur.hingeEdge === "start" ? "end" : "start",
            },
          };
        }
        return i;
      }),
      meta: { ...plan.meta, updatedAt: new Date().toISOString() },
    };
    commit(next);
    set({ plan: history.present });
  },
  toggleSelectedDoorSwingSide: () => {
    const { plan, selectedItems } = get();
    const next: Plan = {
      ...plan,
      items: plan.items.map((i) => {
        if (isDoor(i) && selectedItems.has(i.id)) {
          const cur = i.props ?? { hingeEdge: "start", swingSide: "outside" };
          return {
            ...i,
            props: {
              ...cur,
              swingSide: cur.swingSide === "inside" ? "outside" : "inside",
            },
          };
        }
        return i;
      }),
      meta: { ...plan.meta, updatedAt: new Date().toISOString() },
    };
    commit(next);
    set({ plan: history.present });
  },
  themeMode: initialTheme,
  setThemeMode: (m) => {
    localStorage.setItem(THEME_KEY, m);
    applyThemeAttr(m);
    set({ themeMode: m });
  },
  undo: () => {
    if (!history.past.length) return;
    history = undoHistory(history);
    persist();
    set({ plan: history.present });
  },
  redo: () => {
    if (!history.future.length) return;
    history = redoHistory(history);
    persist();
    set({ plan: history.present });
  },
  marquee: null,
  setMarquee: (m) => set({ marquee: m }),
  loadPlan: (p) => {
    // Loading a document starts a fresh undo timeline.
    history = createHistory(p);
    persist();
    set({
      plan: history.present,
      selectedWalls: new Set(),
      selectedItems: new Set(),
      marquee: null,
    });
  },
  translateSelectedWalls: (dx, dy) => {
    const { plan, selectedWalls } = get();
    if (selectedWalls.size === 0) return;
    const next: Plan = {
      ...plan,
      walls: translateSelectedWallsFollowing(plan.walls, selectedWalls, dx, dy),
      meta: { ...plan.meta, updatedAt: new Date().toISOString() },
    };
    commit(next);
    set({ plan: history.present });
    // (later) also slide attached items with their wall if needed
  },
  translateSelectedWallsLive: (dx, dy) => {
    const { plan, selectedWalls } = get();
    if (selectedWalls.size === 0) return;
    set({
      plan: {
        ...plan,
        walls: translateSelectedWallsFollowing(
          plan.walls,
          selectedWalls,
          dx,
          dy,
        ),
      },
    });
  },
  translateSelectedConnectionPoint: (dx, dy) => {
    const { plan, selectedConnectionPoint } = get();
    if (!selectedConnectionPoint) return;
    const next: Plan = {
      ...plan,
      walls: translateEndpointsAt(plan.walls, selectedConnectionPoint, dx, dy),
      meta: { ...plan.meta, updatedAt: new Date().toISOString() },
    };
    commit(next);
    set({
      plan: history.present,
      selectedConnectionPoint: {
        x: selectedConnectionPoint.x + dx,
        y: selectedConnectionPoint.y + dy,
      },
    });
  },
  translateSelectedConnectionPointLive: (dx, dy) => {
    const { plan, selectedConnectionPoint } = get();
    if (!selectedConnectionPoint) return;
    set({
      plan: {
        ...plan,
        walls: translateEndpointsAt(
          plan.walls,
          selectedConnectionPoint,
          dx,
          dy,
        ),
      },
      selectedConnectionPoint: {
        x: selectedConnectionPoint.x + dx,
        y: selectedConnectionPoint.y + dy,
      },
    });
  },
  commitPlan: () => {
    const next: Plan = {
      ...get().plan,
      meta: { ...get().plan.meta, updatedAt: new Date().toISOString() },
    };
    commit(next);
    set({ plan: history.present });
  },
}));
