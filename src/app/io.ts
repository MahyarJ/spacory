import { pickFixtureMount } from "@geometry/fixtures";
import { reconcileItemsToWalls } from "@geometry/itemGeometry";
import { isPlanLabelText } from "./planLabel";
import {
  createInitialPlan,
  type Fixture,
  type Item,
  MIN_FIXTURE_DIMENSION,
  type Plan,
  type PlanLabel,
  type Point,
  type RoomName,
  type Wall,
  type WallAttachment,
} from "./schema";

/** Current schema version written by exports. */
export const PLAN_VERSION = "1.3.0" as const;

/** Serialize a plan to a pretty-printed JSON string suitable for download. */
export function serializePlan(plan: Plan): string {
  return JSON.stringify(plan, null, 2);
}

/** Thrown when an imported file is not a valid Spacory plan. */
export class PlanParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PlanParseError";
  }
}

// ---- validation helpers -------------------------------------------------

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const isFiniteNumber = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v);

function asPoint(v: unknown, where: string): Point {
  if (!isObject(v) || !isFiniteNumber(v.x) || !isFiniteNumber(v.y)) {
    throw new PlanParseError(`${where} must be a point with numeric x and y`);
  }
  return { x: v.x, y: v.y };
}

function asRoomName(v: unknown, i: number): RoomName {
  if (!isObject(v))
    throw new PlanParseError(`roomNames[${i}] must be an object`);
  if (typeof v.name !== "string" || !v.name.trim()) {
    throw new PlanParseError(`roomNames[${i}].name must be a non-blank string`);
  }
  return { anchor: asPoint(v.anchor, `roomNames[${i}].anchor`), name: v.name };
}

function asLabel(v: unknown, i: number): PlanLabel {
  const where = `labels[${i}]`;
  if (!isObject(v)) throw new PlanParseError(`${where} must be an object`);
  if (typeof v.id !== "string" || !v.id) {
    throw new PlanParseError(`${where}.id must be a non-empty string`);
  }
  if (typeof v.text !== "string" || !isPlanLabelText(v.text)) {
    throw new PlanParseError(`${where}.text must be a non-blank single line`);
  }
  return {
    id: v.id,
    position: asPoint(v.position, `${where}.position`),
    text: v.text,
  };
}

function asFixture(v: unknown, i: number, walls: Wall[]): Fixture | null {
  const where = `fixtures[${i}]`;
  if (!isObject(v)) throw new PlanParseError(`${where} must be an object`);
  if (typeof v.id !== "string" || !v.id.trim()) {
    throw new PlanParseError(`${where}.id must be a non-empty string`);
  }
  if (v.type !== "sink") {
    throw new PlanParseError(`${where}.type must be "sink"`);
  }
  const { depth, side } = v;
  if (!isFiniteNumber(depth) || depth < MIN_FIXTURE_DIMENSION) {
    throw new PlanParseError(
      `${where}.depth must be at least ${MIN_FIXTURE_DIMENSION} cm`,
    );
  }
  // An earlier draft stored free-standing sinks. Reuse their position wherever
  // a wall can host the sink, and keep the rest of the plan in either case.
  if (
    v.wallAttach === undefined &&
    isFiniteNumber(v.rotation) &&
    isFiniteNumber(v.width) &&
    v.width >= MIN_FIXTURE_DIMENSION
  ) {
    const position = asPoint(v.position, `${where}.position`);
    const mount = pickFixtureMount(position, walls, v.width, 30 + depth / 2);
    return mount && { id: v.id, type: v.type, depth, ...mount };
  }
  const wallAttach = asWallAttachment(v.wallAttach, `${where}.wallAttach`);
  if (wallAttach.offset < 0 || wallAttach.length < MIN_FIXTURE_DIMENSION) {
    throw new PlanParseError(
      `${where} must have a non-negative offset and a width of at least ${MIN_FIXTURE_DIMENSION} cm`,
    );
  }
  if (side !== 1 && side !== -1) {
    throw new PlanParseError(`${where}.side must be 1 or -1`);
  }
  return {
    id: v.id,
    type: v.type,
    wallAttach,
    side,
    depth,
  };
}

function asWall(v: unknown, i: number): Wall {
  if (!isObject(v)) throw new PlanParseError(`walls[${i}] must be an object`);
  if (typeof v.id !== "string" || !v.id) {
    throw new PlanParseError(`walls[${i}].id must be a non-empty string`);
  }
  if (!isFiniteNumber(v.thickness) || v.thickness <= 0) {
    throw new PlanParseError(`walls[${i}].thickness must be a positive number`);
  }
  return {
    id: v.id,
    a: asPoint(v.a, `walls[${i}].a`),
    b: asPoint(v.b, `walls[${i}].b`),
    thickness: v.thickness,
  };
}

function asWallAttachment(v: unknown, where: string): WallAttachment {
  if (!isObject(v)) throw new PlanParseError(`${where} must be an object`);
  if (typeof v.wallId !== "string" || !v.wallId) {
    throw new PlanParseError(`${where}.wallId must be a non-empty string`);
  }
  if (!isFiniteNumber(v.offset) || !isFiniteNumber(v.length)) {
    throw new PlanParseError(`${where}.offset and .length must be numbers`);
  }
  return { wallId: v.wallId, offset: v.offset, length: v.length };
}

function asItem(v: unknown, i: number): Item {
  if (!isObject(v)) throw new PlanParseError(`items[${i}] must be an object`);
  if (typeof v.id !== "string" || !v.id) {
    throw new PlanParseError(`items[${i}].id must be a non-empty string`);
  }
  if (!isFiniteNumber(v.thickness) || v.thickness <= 0) {
    throw new PlanParseError(`items[${i}].thickness must be a positive number`);
  }
  const wallAttach = asWallAttachment(v.wallAttach, `items[${i}].wallAttach`);

  if (v.type === "window") {
    return {
      id: v.id,
      type: "window",
      wallAttach,
      thickness: v.thickness,
      props: {},
    };
  }
  if (v.type === "door") {
    const props = isObject(v.props) ? v.props : {};
    const hingeEdge = props.hingeEdge === "end" ? "end" : "start";
    const swingSide = props.swingSide === "inside" ? "inside" : "outside";
    return {
      id: v.id,
      type: "door",
      wallAttach,
      thickness: v.thickness,
      props: { hingeEdge, swingSide },
    };
  }
  throw new PlanParseError(`items[${i}].type must be "door" or "window"`);
}

/**
 * Parse and validate JSON text into a Plan. Throws PlanParseError with a
 * human-readable message if the file is not a valid Spacory plan.
 *
 * Validation is structural rather than version-strict: a different `version`
 * string is accepted (and normalized) as long as the shape is sound, so older
 * exports keep importing. Items referencing a missing wall are dropped.
 */
export function parsePlan(text: string): Plan {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new PlanParseError("File is not valid JSON.");
  }
  return coercePlan(raw);
}

/**
 * Validate an already-parsed value into a Plan. Same rules as parsePlan but
 * operates on a JS value rather than JSON text — used when a plan is nested in
 * a larger payload (e.g. the persisted undo history). Throws PlanParseError.
 */
export function coercePlan(raw: unknown): Plan {
  if (!isObject(raw)) throw new PlanParseError("Plan must be a JSON object.");
  if (!Array.isArray(raw.walls)) {
    throw new PlanParseError('Plan is missing a "walls" array.');
  }
  if (!Array.isArray(raw.items)) {
    throw new PlanParseError('Plan is missing an "items" array.');
  }
  const { roomNames } = raw;
  if (roomNames !== undefined && !Array.isArray(roomNames)) {
    throw new PlanParseError('"roomNames" must be an array.');
  }

  const walls = raw.walls.map(asWall);
  const items = raw.items.map(asItem);
  const labels = raw.labels;
  if (labels !== undefined && !Array.isArray(labels)) {
    throw new PlanParseError('"labels" must be an array.');
  }
  const planLabels = labels?.map(asLabel);
  if (
    planLabels &&
    new Set(planLabels.map(({ id }) => id)).size !== planLabels.length
  ) {
    throw new PlanParseError("Label ids must be unique.");
  }
  const { fixtures } = raw;
  if (fixtures !== undefined && !Array.isArray(fixtures)) {
    throw new PlanParseError('"fixtures" must be an array.');
  }
  const planFixtures = fixtures?.flatMap((fixture, index) => {
    const parsed = asFixture(fixture, index, walls);
    return parsed ? [parsed] : [];
  });
  if (
    planFixtures &&
    new Set(planFixtures.map(({ id }) => id)).size !== planFixtures.length
  ) {
    throw new PlanParseError("Fixture ids must be unique.");
  }

  // Drop items whose wall no longer exists to keep the renderer safe.
  const wallIds = new Set(walls.map((w) => w.id));
  const validItems = items.filter((it) => wallIds.has(it.wallAttach.wallId));

  const defaults = createInitialPlan();
  const meta = isObject(raw.meta) ? raw.meta : {};
  const measurementSystem =
    meta.measurementSystem === "imperial" ? "imperial" : "metric";

  return {
    version: PLAN_VERSION,
    meta: {
      name: typeof meta.name === "string" ? meta.name : defaults.meta.name,
      createdAt:
        typeof meta.createdAt === "string"
          ? meta.createdAt
          : defaults.meta.createdAt,
      updatedAt: new Date().toISOString(),
      measurementSystem,
      gridSize:
        isFiniteNumber(meta.gridSize) && meta.gridSize > 0
          ? meta.gridSize
          : defaults.meta.gridSize,
    },
    walls,
    items: validItems,
    // Keep the field absent for older plans so their saved history still applies.
    ...(roomNames === undefined
      ? {}
      : { roomNames: roomNames.map(asRoomName) }),
    ...(planLabels === undefined ? {} : { labels: planLabels }),
    ...(planFixtures === undefined
      ? {}
      : { fixtures: reconcileItemsToWalls(walls, planFixtures) }),
  };
}
