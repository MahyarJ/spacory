import { create } from "zustand";
import { createInitialPlan, Plan, Wall, Item, isDoor } from "./schema";

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
  updatePlan: (fn) => {
    const clone: Plan = JSON.parse(JSON.stringify(get().plan));
    fn(clone);
    clone.meta.updatedAt = new Date().toISOString();
    commit(clone);
    set({ plan: history.present });
  },
  setView: (fn) => set(({ view }) => ({ view: fn(view) })),
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
              thickness: Math.max(1, Math.round((w.thickness ?? 10) + delta)),
            }
          : w
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
