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
  type Wall,
} from "./schema";
import {
  applyThemeAttr,
  initialTheme,
  THEME_KEY,
  type ThemeMode,
} from "./theming";
import {
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
  isPanning: boolean;
  setTool: (t: Tool) => void;
  addWall: (w: Wall) => void;
  addItem: (i: Item) => void;
  setView: (fn: (v: ViewState) => ViewState) => void;
  setIsPanning: (p: boolean) => void;
  currentWallThickness: number;
  setCurrentWallThickness: (t: number) => void;
  selectedWalls: Set<string>;
  selectedItems: Set<string>;
  selectNone: () => void;
  selectWall: (id: string, additive?: boolean) => void;
  selectItem: (id: string, additive?: boolean) => void;
  deleteSelected: () => void;
  nudgeSelectedWallThickness: (delta: number) => void;
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
  history = commitHistory(history, next);
  persist();
}

// Throttle viewport autosave so continuous wheel/drag stays smooth while still
// persisting the resting position. Separate from the history autosave above —
// the viewport is not part of the Plan or the undo history.
const saveView = throttle(savePersistedView, 200);

function translateWall(w: Wall, dx: number, dy: number): Wall {
  return {
    ...w,
    a: { x: w.a.x + dx, y: w.a.y + dy },
    b: { x: w.b.x + dx, y: w.b.y + dy },
  };
}

export const useApp = create<AppState>((set, get) => ({
  plan: history.present,
  tool: "wall",
  view: loadPersistedView() ?? DEFAULT_VIEW,
  isPanning: false,
  setTool: (t) => set({ tool: t }),
  currentWallThickness: 10, // cm default
  setCurrentWallThickness: (t) => set({ currentWallThickness: Math.max(1, t) }),
  selectedWalls: new Set(),
  selectedItems: new Set(),
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
  setIsPanning: (p) => set({ isPanning: p }),
  selectNone: () => set({ selectedWalls: new Set(), selectedItems: new Set() }),
  selectWall: (id, additive) =>
    set((s) => {
      const ws = additive ? new Set(s.selectedWalls) : new Set<string>();
      ws.add(id);
      return {
        selectedWalls: ws,
        selectedItems: additive ? s.selectedItems : new Set(),
      };
    }),
  selectItem: (id, additive) =>
    set((s) => {
      const is = additive ? new Set(s.selectedItems) : new Set<string>();
      is.add(id);
      return {
        selectedItems: is,
        selectedWalls: additive ? s.selectedWalls : new Set(),
      };
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
      walls: plan.walls.map((wall) => {
        return selectedWalls.has(wall.id) ? translateWall(wall, dx, dy) : wall;
      }),
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
        walls: plan.walls.map((wall) =>
          selectedWalls.has(wall.id) ? translateWall(wall, dx, dy) : wall,
        ),
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
