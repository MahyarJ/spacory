import { getWallLength, MIN_WALL_LENGTH } from "@geometry/wall";
import {
  createInitialPlan,
  type Item,
  type Plan,
  type Point,
  type Units,
  type Wall,
  type WallAttachment,
} from "./schema";

/** Current schema version written by exports. */
export const PLAN_VERSION = "1.2.0" as const;

const VALID_UNITS: Units[] = ["cm", "m", "mm", "in", "ft"];

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

  // Drop degenerate zero-length walls (a === b): they render as nothing but
  // still contribute a dangling connection-point handle. See issue #28.
  const walls = raw.walls
    .map(asWall)
    .filter((w) => getWallLength(w) >= MIN_WALL_LENGTH);
  const items = raw.items.map(asItem);

  // Drop items whose wall no longer exists to keep the renderer safe.
  const wallIds = new Set(walls.map((w) => w.id));
  const validItems = items.filter((it) => wallIds.has(it.wallAttach.wallId));

  const defaults = createInitialPlan();
  const meta = isObject(raw.meta) ? raw.meta : {};
  const units =
    typeof meta.units === "string" && VALID_UNITS.includes(meta.units as Units)
      ? (meta.units as Units)
      : defaults.meta.units;

  return {
    version: PLAN_VERSION,
    meta: {
      name: typeof meta.name === "string" ? meta.name : defaults.meta.name,
      createdAt:
        typeof meta.createdAt === "string"
          ? meta.createdAt
          : defaults.meta.createdAt,
      updatedAt: new Date().toISOString(),
      units,
      gridSize:
        isFiniteNumber(meta.gridSize) && meta.gridSize > 0
          ? meta.gridSize
          : defaults.meta.gridSize,
    },
    walls,
    items: validItems,
  };
}
