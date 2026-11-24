export type MeasurementSystem = "metric" | "imperial";

export interface Point {
  x: number;
  y: number;
}

export interface RoomName {
  anchor: Point;
  name: string;
}

export interface PlanLabel {
  id: string;
  /** World coordinates at the start of the text baseline. */
  position: Point;
  text: string;
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

// biome-ignore lint/suspicious/noEmptyInterface: placeholder kept as a named type for forthcoming window props (mullions, sill depth, etc.).
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

export type FixtureType = "sink";

export interface Fixture {
  id: string;
  type: FixtureType;
  /** World coordinates at the center of the fixture. */
  position: Point;
  width: number;
  depth: number;
  /** Clockwise rotation in degrees. */
  rotation: number;
}

export const MIN_FIXTURE_DIMENSION = 1;

export interface Plan {
  version: "1.3.0";
  meta: {
    name: string;
    createdAt: string;
    updatedAt: string;
    measurementSystem: MeasurementSystem;
    gridSize: number;
  };
  walls: Wall[];
  items: Item[];
  roomNames?: RoomName[];
  labels?: PlanLabel[];
  fixtures?: Fixture[];
}

export const DEFAULT_PLAN_NAME = "Untitled";

export const createInitialPlan = (): Plan => ({
  version: "1.3.0",
  meta: {
    name: DEFAULT_PLAN_NAME,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    measurementSystem: "metric",
    gridSize: 20,
  },
  walls: [],
  items: [],
});

export const isDoor = (i: Item): i is DoorItem => i.type === "door";
export const isWindow = (i: Item): i is WindowItem => i.type === "window";

export function assertNever(x: never): never {
  throw new Error(`Unhandled case: ${String(x)}`);
}
