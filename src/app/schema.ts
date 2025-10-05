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

export type ItemType = "window" | "door";

export interface WallAttachment {
  wallId: string;
  /** absolute distance from wall.a in same units as coordinates (e.g., cm) */
  offset: number;
  /** width of the opening along the wall direction */
  length: number;
}

export interface Item {
  id: string;
  type: ItemType;
  wallAttach: WallAttachment;
  /** visual thickness perpendicular to wall for drawing (e.g., 10cm) */
  thickness: number;
}

export interface Plan {
  version: "1.1.0";
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
  version: "1.1.0",
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
