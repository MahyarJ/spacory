import { create } from "zustand";
import { createInitialPlan, Plan, Wall, Item } from "./schema";

export type Tool = "select" | "wall" | "window" | "door" | "pan";

interface ViewState {
  panX: number;
  panY: number;
  scale: number;
}

interface AppState {
  plan: Plan;
  tool: Tool;
  view: ViewState;
  isPanning: boolean;
  setTool: (t: Tool) => void;
  addWall: (w: Wall) => void;
  addItem: (i: Item) => void;
  updatePlan: (fn: (p: Plan) => void) => void;
  setView: (fn: (v: ViewState) => ViewState) => void;
  setIsPanning: (p: boolean) => void;
  undo: () => void;
  redo: () => void;
}

const history: { past: Plan[]; present: Plan; future: Plan[] } = {
  past: [],
  present: createInitialPlan(),
  future: [],
};

function commit(next: Plan) {
  history.past.push(history.present);
  history.present = next;
  history.future = [];
}

export const useApp = create<AppState>((set, get) => ({
  plan: history.present,
  tool: "wall",
  view: { panX: 0, panY: 0, scale: 1 },
  isPanning: false,
  setTool: (t) => set({ tool: t }),
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
  updatePlan: (fn) => {
    const clone: Plan = JSON.parse(JSON.stringify(get().plan));
    fn(clone);
    clone.meta.updatedAt = new Date().toISOString();
    commit(clone);
    set({ plan: history.present });
  },
  setView: (fn) => set(({ view }) => ({ view: fn(view) })),
  setIsPanning: (p) => set({ isPanning: p }),
  undo: () => {
    if (!history.past.length) return;
    history.future.push(history.present);
    const prev = history.past.pop()!;
    history.present = prev;
    set({ plan: history.present });
  },
  redo: () => {
    if (!history.future.length) return;
    history.past.push(history.present);
    const next = history.future.pop()!;
    history.present = next;
    set({ plan: history.present });
  },
}));
