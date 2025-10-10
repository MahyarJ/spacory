export type Units = "cm" | "m" | "mm" | "in" | "ft";

export interface Point {
  x: number;
  y: number;
}

export interface Wall {
  id: string;
  a: Point;
  b: Point;
  thickness: number;
}

export interface WallAttachment {
  wallId: string;
  /** absolute distance from wall.a in same units as coordinates (e.g., cm) */
  offset: number;
  /** width of the opening along the wall direction */
  length: number;
}

interface ItemBase {
  id: string;
  wallAttach: WallAttachment;
  /** visual thickness perpendicular to wall for drawing (e.g., 10cm) */
  thickness: number;
}

// ---- Item types ----
export interface DoorProps {
  hingeEdge: "start" | "end";
  swingSide: "inside" | "outside";
}

export interface WindowProps {
  // add later: mullions, sill depth, etc.
}

export interface DoorItem extends ItemBase {
  type: "door";
  props: DoorProps;
}

export interface WindowItem extends ItemBase {
  type: "window";
  props: WindowProps;
}

export type Item = DoorItem | WindowItem;

export interface Plan {
  version: "1.2.0";
  meta: {
    name: string;
    createdAt: string;
    updatedAt: string;
    units: Units;
    gridSize: number;
  };
  walls: Wall[];
  items: Item[];
}

export const createInitialPlan = (): Plan => ({
  version: "1.2.0",
  meta: {
    name: "Untitled",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    units: "cm",
    gridSize: 25,
  },
  walls: [],
  items: [],
});

export const isDoor = (i: Item): i is DoorItem => i.type === "door";
export const isWindow = (i: Item): i is WindowItem => i.type === "window";

export function assertNever(x: never): never {
  throw new Error(`Unhandled case: ${String(x)}`);
}
