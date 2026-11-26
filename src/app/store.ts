import { getPlanBounds } from "@geometry/bounds";
import {
  findConnectedEndpoints,
  getConnectionPoints,
  pointsEqual,
  translateEndpoints,
  translateWallEndpoint,
  type WallEndpointRef,
} from "@geometry/connectivity";
import {
  type FixtureConflict,
  type FixtureFootprint,
  type FixtureMount,
  type FixtureMoveConflict,
  fitFixtureSpan,
  fixtureMountEquals,
  getFixtureConflict,
  SINK_DEPTH,
  slideFixtureGroup,
} from "@geometry/fixtures";
import { reconcileItemsToWalls } from "@geometry/itemGeometry";
import { computeWallGeometry, paintedWallPolygons } from "@geometry/junction";
import { MIN_OPENING_WIDTH, resizeOpeningWidth } from "@geometry/opening";
import type { MeasurePlanLabel } from "@geometry/planLabels";
import { detectRooms, findRoomAt, resolveRoomNames } from "@geometry/rooms";
import {
  getWallDirection,
  getWallLength,
  MIN_WALL_LENGTH,
  type WallResizeAnchor,
} from "@geometry/wall";
import { mergeWallsAtVacatedSeams } from "@geometry/wallMerge";
import { resizeWallInPlan } from "@geometry/wallResize";
import {
  resolveWeldedPoint,
  splitWallsAtTouchingEndpoints,
} from "@geometry/wallSplit";
import { create } from "zustand";
import { throttle } from "../util/throttle";
import { uid } from "../util/uid";
import {
  commit as commitHistory,
  createHistory,
  type History,
  redo as redoHistory,
  undo as undoHistory,
} from "./history";
import { loadPersistedHistory, savePersistedHistory } from "./persistence";
import { isPlanLabelText } from "./planLabel";
import { isRoomNameTooLong } from "./roomName";
import {
  createInitialPlan,
  type Fixture,
  type FixtureType,
  type Item,
  isDoor,
  type MeasurementSystem,
  MIN_FIXTURE_DIMENSION,
  type Plan,
  type PlanLabel,
  type Point,
  type Wall,
  type WallMountedObject,
} from "./schema";
import {
  getFixtureLabelSelection,
  isWallOnlySelection,
  type LabelTranslation,
  selectionCount,
} from "./selection";
import {
  applyThemeAttr,
  initialTheme,
  THEME_KEY,
  type ThemeMode,
} from "./theming";
import { drawingThickness, type ThicknessPreset } from "./thickness";
import {
  computeFitView,
  DEFAULT_VIEW,
  FIT_PADDING,
  loadPersistedView,
  MIN_SCALE,
  savePersistedView,
  type ViewState,
} from "./viewport";

export type Tool =
  | "select"
  | "wall"
  | "window"
  | "door"
  | "label"
  | "pan"
  | FixtureType;

type FixtureEdit = { width?: number; depth?: number };
type FixtureResizePreview = ReturnType<typeof previewFixtureResize>;

type WallLengthEdit = {
  wallId: string;
  length: number | null;
  anchor: WallResizeAnchor;
  preview: ReturnType<typeof previewWallResize>;
};

interface AppState {
  plan: Plan;
  tool: Tool;
  view: ViewState;
  /** Canvas size in CSS pixels, mirrored from the SVG element (FloorPlan). */
  canvasSize: { width: number; height: number };
  isPanning: boolean;
  setTool: (t: Tool) => void;
  setMeasurementSystem: (system: MeasurementSystem) => void;
  addWall: (w: Wall) => void;
  addItem: (i: Item) => void;
  placeFixture: (mount: FixtureMount) => FixtureConflict | undefined;
  updateFixture: (id: string, edit: FixtureEdit) => FixtureConflict | undefined;
  fixtureResizePreview: FixtureResizePreview;
  setFixtureResizePreview: (preview: FixtureResizePreview) => void;
  duplicateFixture: (id: string) => FixtureConflict | undefined;
  moveFixtureSelection: (
    moves: Array<FixtureMount & { id: string }>,
    labels?: LabelTranslation,
  ) => FixtureConflict | undefined;
  setView: (fn: (v: ViewState) => ViewState) => void;
  setCanvasSize: (size: { width: number; height: number }) => void;
  /**
   * Frame the whole plan in the canvas with a small margin, or reset to
   * DEFAULT_VIEW when empty. Routed through `setView` so the result autosaves.
   */
  fitView: (measureLabel?: MeasurePlanLabel) => void;
  setIsPanning: (p: boolean) => void;
  currentWallThickness: number;
  wallThicknessPreset: ThicknessPreset | null;
  setWallThicknessPreset: (preset: ThicknessPreset) => void;
  setCurrentWallThickness: (t: number) => void;
  selectedWalls: Set<string>;
  selectedItems: Set<string>;
  selectedLabels: Set<string>;
  selectedFixtures: Set<string>;
  selectFixture: (id: string, additive?: boolean) => void;
  labelEditor: { id?: string; position: Point } | null;
  selectLabels: (ids: string[], additive?: boolean) => void;
  setLabelEditor: (editor: AppState["labelEditor"]) => void;
  finishLabelEdit: (text?: string) => void;
  selectedRoomPoint: Point | null;
  selectRoom: (point: Point) => void;
  setSelectedRoomName: (name: string) => void;
  /** The single connection point (shared wall-endpoint coordinate) currently selected. */
  selectedConnectionPoint: Point | null;
  /**
   * The wall endpoints that belonged to `selectedConnectionPoint`'s junction at
   * the moment it was selected (grab time), fixed for the life of the
   * selection/gesture. Drag translation moves exactly this set rather than
   * re-deriving membership from the live coordinate on every tick, so merely
   * passing over an unrelated junction's coordinate mid-drag can't weld it in.
   */
  selectedConnectionPointEndpoints: WallEndpointRef[];
  selectNone: () => void;
  selectWall: (id: string, additive?: boolean) => void;
  selectItem: (id: string, additive?: boolean) => void;
  selectConnectionPoint: (point: Point) => void;
  deleteSelected: () => void;
  nudgeSelectedWallThickness: (delta: number) => void;
  /** Transient editor input for canvas feedback. */
  wallLengthEdit: WallLengthEdit | null;
  setWallLengthEdit: (edit: WallLengthEdit | null) => void;
  setSelectedWallLength: (length: number, anchor?: WallResizeAnchor) => void;
  setSelectedOpeningWidth: (width: number) => void;
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
  translateSelection: (
    dx: number,
    dy: number,
  ) => FixtureMoveConflict | undefined;
  /** Move selected walls and labels together without writing to history. */
  translateSelectionLive: (dx: number, dy: number) => void;
  /**
   * Move every wall endpoint at the selected connection point, committing a
   * single undo step (used for arrow-key nudge).
   */
  translateSelectedConnectionPoint: (dx: number, dy: number) => void;
  /** Same, but without writing to history (live drag preview). */
  translateSelectedConnectionPointLive: (dx: number, dy: number) => void;
  /**
   * Move a single wall's endpoint (`a` or `b`) to an absolute target
   * coordinate, without writing history (live drag preview) — the "detach one
   * wall from a junction" gesture. Absolute targeting (rather than an
   * accumulated delta) keeps the preview drift-free and lets the
   * MIN_WALL_LENGTH guard simply reject a tick that would collapse the wall,
   * since the next tick recomputes the delta from the wall's true endpoint.
   * Commit the result via `commitPlan` — the same live-then-commit pattern as
   * the connection-point drag.
   */
  moveWallEndpointLive: (ref: WallEndpointRef, target: Point) => void;
  /**
   * Snapshot of `plan.items` as they stood when a live drag gesture started, or
   * `null` when no gesture is in progress. The `*Live` functions reconcile this
   * pre-drag snapshot against the wall's current live length on every tick —
   * never the previous tick's already-reconciled result — so reversing a drag
   * (regrowing the wall) within the same gesture restores removed items and
   * exact pre-drag offsets, rather than compounding tick-over-tick.
   */
  liveDragItems: Item[] | null;
  /**
   * `selectedConnectionPoint` as it stood when a live drag gesture started, or
   * `null` when nothing was selected / no gesture is in progress. A junction
   * drag advances the selected point on every tick alongside the plan, so
   * abandoning the gesture has to put the selection back too (see
   * `cancelLiveDrag`) or the handle renders away from the junction and the next
   * nudge re-derives an empty endpoint set from the stale coordinate.
   */
  liveDragConnectionPoint: Point | null;
  /** Capture the pre-drag item/selection snapshot at the start of a live drag gesture. */
  beginLiveDrag: () => void;
  /** Clear the pre-drag snapshot when a live drag ends without committing. */
  endLiveDrag: () => void;
  /**
   * Abandon a live drag: roll the plan back to the last committed state, put the
   * connection-point selection back where the drag found it, and drop the
   * snapshot. Unlike `endLiveDrag` (which keeps whatever the preview moved,
   * for a drag that ended where it started), this undoes the preview itself —
   * for a gesture that never gets a chance to finish, e.g. a `pointercancel` or
   * a second finger turning a drag into a pan/pinch. Adds no history entry.
   */
  cancelLiveDrag: () => void;
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

function mountedObjects(plan: Plan): WallMountedObject[] {
  return plan.fixtures?.length ? [...plan.items, ...plan.fixtures] : plan.items;
}

function separateMountedObjects(objects: WallMountedObject[], plan: Plan) {
  return {
    items: objects.filter((item): item is Item => item.type !== "sink"),
    ...(plan.fixtures === undefined
      ? {}
      : {
          fixtures: objects.filter(
            (item): item is Fixture => item.type === "sink",
          ),
        }),
  };
}

function normalizeWallEdit<T extends WallMountedObject>(
  before: Wall[],
  next: { walls: Wall[]; items: T[] },
  nextWallId: () => string,
  fixedPoints?: Point[],
) {
  // A vacated seam can still lie inside its host's body. Merge before splitting
  // so the endpoint can be welded back onto a single, continuous wall.
  const merged = mergeWallsAtVacatedSeams(before, next.walls, next.items);
  return splitWallsAtTouchingEndpoints(merged.walls, merged.items, nextWallId, {
    fixedPoints,
  });
}

export function previewWallResize(
  plan: Plan,
  wall: Wall,
  length: number,
  anchor: WallResizeAnchor,
): Wall[] | "blocked-junction" | null {
  // Splits need distinct IDs even during a preview. They are local to this
  // calculation and never enter the committed plan.
  const existingIds = new Set(plan.walls.map((w) => w.id));
  let index = 0;
  const nextWallId = () => {
    let id: string;
    do {
      id = `preview-wall-${++index}`;
    } while (existingIds.has(id));
    return id;
  };
  const resize = resizeWallInPlan(
    plan.walls,
    plan.items,
    wall,
    length,
    nextWallId,
    anchor,
  );
  if (!resize || resize === "blocked-junction") return resize;
  return normalizeWallEdit(plan.walls, resize, nextWallId, [
    resize.resized.a,
    resize.resized.b,
  ]).walls;
}

/**
 * Commit `next` as one history entry and return the state patch every action
 * that edits the plan applies: the committed plan, plus the selection brought
 * up to date with it — the held connection point re-pointed at wherever the
 * split welded it (and dropped if the commit left no endpoint on it), its
 * membership re-derived from the committed walls, and any selected wall/item the
 * commit removed pruned out.
 *
 * `heldPoint` defaults to the caller's `selectedConnectionPoint`; actions that
 * move it can supply its new coordinate. Commit and selection are
 * one step on purpose: the split can pull a selected junction onto a host wall's
 * centreline, and the merge can make its coordinate vanish altogether. Either
 * way a stale selection is *invisible but still live* —
 * `ConnectionPointsLayer` only highlights a handle a wall endpoint actually sits
 * at, while an arrow key still routes to the nudge — so the next keypress moves
 * walls the user can't see selected. Committing through a separate step let
 * three actions forget in turn; with one function a new action can't.
 */
function commit(
  next: Plan,
  selection: Pick<
    AppState,
    | "selectedConnectionPoint"
    | "selectedConnectionPointEndpoints"
    | "selectedWalls"
    | "selectedItems"
    | "selectedFixtures"
  >,
  heldPoint: Point | null = selection.selectedConnectionPoint,
  fixedPoints?: Point[],
): Pick<
  AppState,
  | "plan"
  | "selectedConnectionPoint"
  | "selectedConnectionPointEndpoints"
  | "selectedWalls"
  | "selectedItems"
  | "selectedFixtures"
> {
  // Edits that leave walls and openings alone skip wall normalization. This
  // also lets metadata commits preserve the selection during a live drag.
  if (
    next.walls === history.present.walls &&
    next.items === history.present.items
  ) {
    history = commitHistory(history, next);
    persist();
    return {
      plan: history.present,
      selectedConnectionPoint: selection.selectedConnectionPoint,
      selectedConnectionPointEndpoints:
        selection.selectedConnectionPointEndpoints,
      selectedWalls: selection.selectedWalls,
      selectedItems: selection.selectedItems,
      selectedFixtures: prunedIds(
        selection.selectedFixtures,
        next.fixtures ?? [],
      ),
    };
  }
  // Merge seams vacated by this edit before splitting any new mid-span joins.
  // Both changes ride in the same history entry as the edit.
  const split = normalizeWallEdit(
    history.present.walls,
    { walls: next.walls, items: mountedObjects(next) },
    () => uid("wall"),
    fixedPoints,
  );
  // Reconcile wall-mounted objects against the host's current length here so
  // every wall-resize path (type-to-length, connection-point drag, auto-follow)
  // is covered without touching each call site individually.
  const reconciled: Plan = {
    ...next,
    walls: split.walls,
    ...separateMountedObjects(
      reconcileItemsToWalls(split.walls, split.items),
      next,
    ),
  };
  history = commitHistory(history, reconciled);
  persist();
  const present = history.present;
  const moved = heldPoint ? resolveWeldedPoint(split.welds, heldPoint) : null;
  const endpoints = moved ? findConnectedEndpoints(present.walls, moved) : [];
  return {
    plan: present,
    // No endpoint left on the coordinate — the merge collapsed the seam, or the
    // walls that met there are gone — so there is no handle to show and nothing
    // for a nudge to move: drop the selection rather than leave it live.
    selectedConnectionPoint: endpoints.length > 0 ? moved : null,
    selectedConnectionPointEndpoints: endpoints,
    selectedWalls: prunedIds(selection.selectedWalls, present.walls),
    selectedItems: prunedIds(selection.selectedItems, present.items),
    selectedFixtures: prunedIds(
      selection.selectedFixtures,
      present.fixtures ?? [],
    ),
  };
}

/**
 * Drop selected ids the committed plan no longer has — the merge removes a wall
 * id, and the item reconcile can remove an opening — so no selection outlives
 * its subject. Returns the same Set when nothing was pruned, so an unaffected
 * commit doesn't re-render every selection-driven layer.
 */
function prunedIds(
  selected: Set<string>,
  present: { id: string }[],
): Set<string> {
  if (selected.size === 0) return selected;
  const live = new Set(
    [...selected].filter((id) => present.some((e) => e.id === id)),
  );
  return live.size === selected.size ? selected : live;
}

function emptySelection() {
  return {
    selectedWalls: new Set<string>(),
    selectedItems: new Set<string>(),
    selectedRoomPoint: null,
    selectedLabels: new Set<string>(),
    selectedFixtures: new Set<string>(),
    labelEditor: null,
    selectedConnectionPoint: null,
    selectedConnectionPointEndpoints: [],
  };
}

function commitLabels(labels: PlanLabel[], state: AppState) {
  const plan = history.present;
  return commit(
    {
      ...plan,
      labels,
      meta: { ...plan.meta, updatedAt: new Date().toISOString() },
    },
    state,
  );
}

function commitFixtures(fixtures: Fixture[], state: AppState) {
  const plan = history.present;
  return commit(
    {
      ...plan,
      fixtures,
      meta: { ...plan.meta, updatedAt: new Date().toISOString() },
    },
    state,
  );
}

function fixtureConflict(
  plan: Plan,
  fixture: FixtureFootprint,
  paintedWalls = paintedWallPolygons(computeWallGeometry(plan.walls)),
) {
  const wall = plan.walls.find(({ id }) => id === fixture.wallAttach.wallId);
  if (!wall) return "width";
  return getFixtureConflict(fixture, wall, plan.items, paintedWalls);
}

function moveFixtureSelectionInPlan(
  plan: Plan,
  moves: Array<FixtureMount & { id: string }>,
  labels?: LabelTranslation,
): { next: Plan; conflict?: FixtureConflict } {
  if (!plan.fixtures || moves.length === 0) return { next: plan };
  const byId = new Map(moves.map((move) => [move.id, move]));
  const paintedWalls = paintedWallPolygons(computeWallGeometry(plan.walls));
  const fixtures: Fixture[] = [];
  let changed = false;
  for (const fixture of plan.fixtures) {
    const move = byId.get(fixture.id);
    if (!move) {
      fixtures.push(fixture);
      continue;
    }
    const candidate = {
      ...fixture,
      wallAttach: move.wallAttach,
      side: move.side,
    };
    const conflict = fixtureConflict(plan, candidate, paintedWalls);
    if (conflict) return { next: plan, conflict };
    if (fixtureMountEquals(fixture, move)) fixtures.push(fixture);
    else {
      changed = true;
      fixtures.push(candidate);
    }
  }
  const translatedLabels =
    labels && plan.labels && (labels.delta.x !== 0 || labels.delta.y !== 0)
      ? plan.labels.map((label) =>
          labels.ids.has(label.id)
            ? {
                ...label,
                position: {
                  x: label.position.x + labels.delta.x,
                  y: label.position.y + labels.delta.y,
                },
              }
            : label,
        )
      : plan.labels;
  return {
    next:
      changed || translatedLabels !== plan.labels
        ? {
            ...plan,
            fixtures,
            ...(translatedLabels ? { labels: translatedLabels } : {}),
          }
        : plan,
  };
}

export function previewFixtureResize(
  plan: Plan,
  fixture: Fixture,
  edit: FixtureEdit,
): { fixture: Fixture; conflict: FixtureConflict | null } | null {
  const { offset, length, wallId } = fixture.wallAttach;
  const width = edit.width ?? length;
  const depth = edit.depth ?? fixture.depth;
  if (
    !Number.isFinite(width) ||
    width < MIN_FIXTURE_DIMENSION ||
    !Number.isFinite(depth) ||
    depth < MIN_FIXTURE_DIMENSION ||
    (width === length && depth === fixture.depth)
  )
    return null;

  const wall = plan.walls.find((candidate) => candidate.id === wallId);
  if (!wall) return null;

  const center = offset + length / 2;
  const tooWide = width > getWallLength(wall);
  const wallAttach =
    width === length
      ? fixture.wallAttach
      : tooWide
        ? { wallId, offset: center - width / 2, length: width }
        : fitFixtureSpan(wall, width, center);
  const candidate = { ...fixture, wallAttach, depth };
  return {
    fixture: candidate,
    conflict: tooWide ? "width" : fixtureConflict(plan, candidate),
  };
}

function previewMountedFixtures(walls: Wall[]) {
  const { fixtures } = history.present;
  return fixtures ? { fixtures: reconcileItemsToWalls(walls, fixtures) } : {};
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

function translatePlanSelection(
  state: Pick<
    AppState,
    | "plan"
    | "selectedWalls"
    | "selectedItems"
    | "selectedLabels"
    | "selectedFixtures"
  >,
  dx: number,
  dy: number,
): { next: Plan; conflict?: FixtureMoveConflict } {
  const { plan, selectedWalls, selectedLabels, selectedFixtures } = state;
  if (
    (dx === 0 && dy === 0) ||
    (!selectedWalls.size && !selectedLabels.size && !selectedFixtures.size)
  ) {
    return { next: plan };
  }
  const mixed = getFixtureLabelSelection(state);
  if (mixed) {
    const walls = new Map(plan.walls.map((wall) => [wall.id, wall]));
    const { moved, delta, conflict } = slideFixtureGroup(
      mixed.fixtures,
      { x: dx, y: dy },
      walls,
    );
    return conflict
      ? { next: plan, conflict }
      : moveFixtureSelectionInPlan(plan, moved, { ids: mixed.labelIds, delta });
  }
  let conflict: FixtureConflict | undefined;
  const fixtures =
    selectedWalls.size === 0 && selectedFixtures.size
      ? plan.fixtures?.map((fixture) => {
          if (!selectedFixtures.has(fixture.id)) return fixture;
          const { wallId, offset, length } = fixture.wallAttach;
          const wall = plan.walls.find((candidate) => candidate.id === wallId);
          if (!wall) return fixture;
          const along = getWallDirection(wall);
          const wallAttach = fitFixtureSpan(
            wall,
            length,
            offset + length / 2 + dx * along.x + dy * along.y,
          );
          if (wallAttach.offset === offset) return fixture;
          const candidate = { ...fixture, wallAttach };
          const reason = fixtureConflict(plan, candidate);
          if (!reason) return candidate;
          conflict = reason;
          return fixture;
        })
      : plan.fixtures;
  const fixturesMoved = fixtures?.some(
    (fixture, index) => fixture !== plan.fixtures?.[index],
  );
  if (!selectedWalls.size && !selectedLabels.size && !fixturesMoved)
    return { next: plan, conflict };
  return {
    conflict,
    next: {
      ...plan,
      walls: selectedWalls.size
        ? translateSelectedWallsFollowing(plan.walls, selectedWalls, dx, dy)
        : plan.walls,
      ...(selectedLabels.size && plan.labels
        ? {
            labels: plan.labels.map((label) =>
              selectedLabels.has(label.id)
                ? {
                    ...label,
                    position: {
                      x: label.position.x + dx,
                      y: label.position.y + dy,
                    },
                  }
                : label,
            ),
          }
        : {}),
      ...(fixturesMoved ? { fixtures } : {}),
    },
  };
}

export const useApp = create<AppState>((set, get) => ({
  plan: history.present,
  tool: "wall",
  view: loadPersistedView() ?? DEFAULT_VIEW,
  canvasSize: { width: 800, height: 600 },
  isPanning: false,
  setTool: (tool) => {
    if (tool === "label" || tool === "sink") set({ ...emptySelection(), tool });
    else if (tool === "select" && get().tool === "select") set({ tool });
    else
      set({
        tool,
        selectedRoomPoint: null,
        selectedLabels: new Set(),
        selectedFixtures: new Set(),
        labelEditor: null,
      });
  },
  setMeasurementSystem: (measurementSystem) => {
    const state = get();
    if (state.plan.meta.measurementSystem === measurementSystem) return;
    const committed = commit(
      {
        ...history.present,
        meta: {
          ...history.present.meta,
          measurementSystem,
          updatedAt: new Date().toISOString(),
        },
      },
      state,
    );
    set({
      ...committed,
      // Keep the in-flight preview and drag snapshots intact. Only metadata is
      // shared with history, so either cancel or release still owns the drag.
      plan: { ...state.plan, meta: committed.plan.meta },
      currentWallThickness: drawingThickness(
        measurementSystem,
        state.wallThicknessPreset,
        state.currentWallThickness,
      ),
    });
  },
  wallThicknessPreset: "standard",
  currentWallThickness: drawingThickness(
    history.present.meta.measurementSystem,
    "standard",
    10,
  ),
  setWallThicknessPreset: (wallThicknessPreset) =>
    set({
      wallThicknessPreset,
      currentWallThickness: drawingThickness(
        get().plan.meta.measurementSystem,
        wallThicknessPreset,
        get().currentWallThickness,
      ),
    }),
  setCurrentWallThickness: (t) => {
    if (!Number.isFinite(t)) return;
    set({ currentWallThickness: Math.max(1, t), wallThicknessPreset: null });
  },
  ...emptySelection(),
  addWall: (w) => {
    const next: Plan = {
      ...get().plan,
      walls: [...get().plan.walls, w],
      meta: { ...get().plan.meta, updatedAt: new Date().toISOString() },
    };
    // A drawn wall passing within `thickness / 2` of a selected junction welds
    // that junction onto the new wall's centreline, so the selection has to
    // follow it. Neither switching to the wall tool nor drawing clears a
    // connection-point selection, so this is reachable.
    set(commit(next, get()));
  },
  addItem: (i) => {
    const next: Plan = {
      ...get().plan,
      items: [...get().plan.items, i],
      meta: { ...get().plan.meta, updatedAt: new Date().toISOString() },
    };
    set(commit(next, get()));
  },
  placeFixture: (mount) => {
    const state = get();
    if (state.liveDragItems) return;
    const conflict = fixtureConflict(state.plan, {
      ...mount,
      depth: SINK_DEPTH,
    });
    if (conflict) return conflict;
    const fixture: Fixture = {
      ...mount,
      id: uid("fixture"),
      type: "sink",
      depth: SINK_DEPTH,
    };
    set({
      ...commitFixtures([...(history.present.fixtures ?? []), fixture], state),
      ...emptySelection(),
      selectedFixtures: new Set([fixture.id]),
      tool: "select",
    });
  },
  fixtureResizePreview: null,
  setFixtureResizePreview: (fixtureResizePreview) =>
    set({ fixtureResizePreview }),
  updateFixture: (id, edit) => {
    const state = get();
    const plan = history.present;
    const { fixtures } = plan;
    const fixture = fixtures?.find((item) => item.id === id);
    if (state.liveDragItems || !fixtures || !fixture) return;
    const preview = previewFixtureResize(plan, fixture, edit);
    if (!preview) return;
    if (preview.conflict) return preview.conflict;
    set(
      commitFixtures(
        fixtures.map((item) => (item === fixture ? preview.fixture : item)),
        state,
      ),
    );
  },
  duplicateFixture: (id) => {
    const state = get();
    const { fixtures, meta, walls } = history.present;
    const fixture = fixtures?.find((item) => item.id === id);
    if (state.liveDragItems || !fixtures || !fixture) return;
    const { wallId, offset, length } = fixture.wallAttach;
    const wall = walls.find((candidate) => candidate.id === wallId);
    if (!wall) return;
    const shift = length + meta.gridSize;
    const ahead = getWallLength(wall) - offset - length;
    const direction = ahead >= shift || ahead >= offset ? 1 : -1;
    const copyAt = (direction: number) => ({
      ...fixture,
      wallAttach: fitFixtureSpan(
        wall,
        length,
        offset + length / 2 + direction * shift,
      ),
    });
    let copy = copyAt(direction);
    const conflict = fixtureConflict(history.present, copy);
    if (conflict) {
      copy = copyAt(-direction);
      if (
        fixtureMountEquals(fixture, copy) ||
        fixtureConflict(history.present, copy)
      )
        return conflict;
    }
    copy.id = uid("fixture");
    set({
      ...commitFixtures([...fixtures, copy], state),
      ...emptySelection(),
      selectedFixtures: new Set([copy.id]),
    });
  },
  moveFixtureSelection: (moves, labels) => {
    const state = get();
    const plan = history.present;
    const { next, conflict } = moveFixtureSelectionInPlan(plan, moves, labels);
    if (next !== plan) {
      set(
        commit(
          {
            ...next,
            meta: { ...next.meta, updatedAt: new Date().toISOString() },
          },
          state,
        ),
      );
    }
    return conflict;
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
  fitView: (measureLabel) => {
    const { plan, canvasSize, setView } = get();
    const minScale =
      plan.labels?.length || plan.fixtures?.length ? 0 : MIN_SCALE;
    const next = computeFitView(
      getPlanBounds(plan, measureLabel),
      canvasSize,
      FIT_PADDING,
      minScale,
    );
    setView(() => next);
  },
  setIsPanning: (p) => set({ isPanning: p }),
  selectNone: () => set(emptySelection()),
  selectLabels: (ids, additive) =>
    set((state) => ({
      ...emptySelection(),
      selectedWalls: additive ? state.selectedWalls : new Set(),
      selectedItems: additive ? state.selectedItems : new Set(),
      selectedFixtures: additive ? state.selectedFixtures : new Set(),
      selectedLabels: new Set(
        additive ? [...state.selectedLabels, ...ids] : ids,
      ),
    })),
  setLabelEditor: (labelEditor) => set({ labelEditor }),
  finishLabelEdit: (text) => {
    const state = get();
    const { labelEditor, liveDragItems } = state;
    if (!labelEditor || liveDragItems) return;
    const labels = history.present.labels ?? [];
    if (text === undefined || !isPlanLabelText(text)) {
      if (labelEditor.id && text !== undefined && !text.trim())
        state.deleteSelected();
      else set({ labelEditor: null });
      return;
    }
    if (labelEditor.id === undefined) {
      let id = uid("label");
      while (labels.some((label) => label.id === id)) id = uid("label");
      set({
        ...commitLabels(
          [...labels, { id, position: labelEditor.position, text }],
          state,
        ),
        labelEditor: null,
      });
      return;
    }

    const { id } = labelEditor;
    const label = labels.find((label) => label.id === id);
    if (label && label.text !== text) {
      set({
        ...commitLabels(
          labels.map((entry) => (entry === label ? { ...label, text } : entry)),
          state,
        ),
        labelEditor: null,
      });
    } else {
      set({ labelEditor: null });
    }
  },
  selectRoom: (point) =>
    set({
      ...emptySelection(),
      selectedRoomPoint: point,
    }),
  setSelectedRoomName: (value) => {
    const state = get();
    const { selectedRoomPoint } = state;
    if (!selectedRoomPoint || state.liveDragItems || isRoomNameTooLong(value))
      return;
    const plan = history.present;
    const rooms = detectRooms(plan.walls);
    const room = findRoomAt(rooms, selectedRoomPoint);
    if (!room) return;

    const roomNames = plan.roomNames ?? [];
    const existing = resolveRoomNames(rooms, roomNames).get(room);
    const name = value.trim() ? value : "";
    if (name === (existing?.name ?? "")) return;
    const nextNames = [...roomNames];
    if (existing) {
      const index = roomNames.indexOf(existing);
      if (name) nextNames[index] = { ...existing, name };
      else nextNames.splice(index, 1);
    } else {
      nextNames.push({ anchor: room.labelPoint, name });
    }
    set(
      commit(
        {
          ...plan,
          roomNames: nextNames,
          meta: { ...plan.meta, updatedAt: new Date().toISOString() },
        },
        state,
      ),
    );
  },
  selectWall: (id, additive) =>
    set((s) => {
      const ws = additive ? new Set(s.selectedWalls) : new Set<string>();
      ws.add(id);
      return {
        selectedWalls: ws,
        selectedItems: additive ? s.selectedItems : new Set(),
        selectedRoomPoint: null,
        selectedLabels: additive ? s.selectedLabels : new Set(),
        selectedFixtures: additive ? s.selectedFixtures : new Set(),
        labelEditor: null,
        selectedConnectionPoint: null,
        selectedConnectionPointEndpoints: [],
      };
    }),
  selectItem: (id, additive) =>
    set((s) => {
      const is = additive ? new Set(s.selectedItems) : new Set<string>();
      is.add(id);
      return {
        selectedItems: is,
        selectedWalls: additive ? s.selectedWalls : new Set(),
        selectedRoomPoint: null,
        selectedLabels: additive ? s.selectedLabels : new Set(),
        selectedFixtures: additive ? s.selectedFixtures : new Set(),
        labelEditor: null,
        selectedConnectionPoint: null,
        selectedConnectionPointEndpoints: [],
      };
    }),
  selectFixture: (id, additive) =>
    set((state) => ({
      ...emptySelection(),
      selectedWalls: additive ? state.selectedWalls : new Set(),
      selectedItems: additive ? state.selectedItems : new Set(),
      selectedLabels: additive ? state.selectedLabels : new Set(),
      selectedFixtures: new Set(
        additive ? [...state.selectedFixtures, id] : [id],
      ),
    })),
  selectConnectionPoint: (point) =>
    set((s) => ({
      ...emptySelection(),
      selectedConnectionPoint: point,
      // Snapshot the junction's membership once, at grab time — the live drag
      // and nudge translate exactly this set (see `selectedConnectionPointEndpoints`).
      selectedConnectionPointEndpoints: findConnectedEndpoints(
        s.plan.walls,
        point,
      ),
    })),
  deleteSelected: () => {
    const state = get();
    const {
      selectedWalls,
      selectedItems,
      selectedLabels,
      selectedFixtures,
      plan,
    } = state;
    if (
      selectionCount(
        selectedWalls,
        selectedItems,
        selectedLabels,
        selectedFixtures,
      ) === 0 ||
      ((selectedLabels.size || selectedFixtures.size) && state.liveDragItems)
    )
      return;
    const next: Plan = {
      ...plan,
      walls: selectedWalls.size
        ? plan.walls.filter((w) => !selectedWalls.has(w.id))
        : plan.walls,
      items: selectedItems.size
        ? plan.items.filter((i) => !selectedItems.has(i.id))
        : plan.items,
      ...(selectedFixtures.size && plan.fixtures
        ? {
            fixtures: plan.fixtures.filter(
              ({ id }) => !selectedFixtures.has(id),
            ),
          }
        : {}),
      ...(selectedLabels.size && plan.labels
        ? {
            labels: plan.labels.filter(
              (label) => !selectedLabels.has(label.id),
            ),
          }
        : {}),
      meta: { ...plan.meta, updatedAt: new Date().toISOString() },
    };
    set({
      ...commit(next, state),
      ...emptySelection(),
    });
  },
  nudgeSelectedWallThickness: (delta) => {
    const state = get();
    const {
      selectedWalls,
      selectedItems,
      selectedLabels,
      selectedFixtures,
      plan,
    } = state;
    if (
      !isWallOnlySelection(
        selectedWalls,
        selectedItems,
        selectedLabels,
        selectedFixtures,
      )
    )
      return;
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
    set(commit(next, state));
  },
  wallLengthEdit: null,
  setWallLengthEdit: (wallLengthEdit) => set({ wallLengthEdit }),
  setSelectedWallLength: (length, anchor) => {
    const state = get();
    const { selectedWalls, plan, selectedConnectionPoint } = state;
    if (selectedWalls.size !== 1) return;
    const [id] = selectedWalls;
    const wall = plan.walls.find((w) => w.id === id);
    if (!wall) return;
    const resize = resizeWallInPlan(
      plan.walls,
      mountedObjects(plan),
      wall,
      length,
      () => uid("wall"),
      anchor,
    );
    if (!resize || resize === "blocked-junction") return;
    const next: Plan = {
      ...plan,
      walls: resize.walls,
      ...separateMountedObjects(resize.items, plan),
      meta: { ...plan.meta, updatedAt: new Date().toISOString() },
    };
    // A nearby wall can split at an exact touch, but snapping to its
    // centreline must not change the entered length or the wall's angle.
    set(
      commit(next, state, resize.followPoint(selectedConnectionPoint), [
        resize.resized.a,
        resize.resized.b,
      ]),
    );
  },
  setSelectedOpeningWidth: (width) => {
    const { selectedItems, plan } = get();
    if (selectedItems.size !== 1) return;
    if (!Number.isFinite(width) || width < MIN_OPENING_WIDTH) return;
    const [id] = selectedItems;
    const item = plan.items.find((i) => i.id === id);
    if (!item) return;
    const wall = plan.walls.find((w) => w.id === item.wallAttach.wallId);
    if (!wall) return;
    const resized = resizeOpeningWidth(
      item.wallAttach,
      getWallLength(wall),
      width,
    );
    // Skip a no-op resize so we don't push an empty undo step.
    if (
      resized.offset === item.wallAttach.offset &&
      resized.length === item.wallAttach.length
    ) {
      return;
    }
    const next: Plan = {
      ...plan,
      items: plan.items.map((i) =>
        i.id === id ? { ...i, wallAttach: { ...i.wallAttach, ...resized } } : i,
      ),
      meta: { ...plan.meta, updatedAt: new Date().toISOString() },
    };
    set(commit(next, get()));
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
    set(commit(next, get()));
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
    set(commit(next, get()));
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
    // A history jump replaces the preview and ends its live drag.
    // A held connection-point selection has no reliable meaning across a
    // history jump (the coordinate it was grabbed at may no longer be a
    // junction, or may now match an unrelated one), so drop it rather than
    // risk a following nudge dragging the wrong walls.
    set({
      plan: history.present,
      currentWallThickness: drawingThickness(
        history.present.meta.measurementSystem,
        get().wallThicknessPreset,
        get().currentWallThickness,
      ),
      selectedConnectionPoint: null,
      selectedLabels: new Set(),
      selectedFixtures: prunedIds(
        get().selectedFixtures,
        history.present.fixtures ?? [],
      ),
      labelEditor: null,
      selectedConnectionPointEndpoints: [],
      liveDragItems: null,
      liveDragConnectionPoint: null,
    });
  },
  redo: () => {
    if (!history.future.length) return;
    history = redoHistory(history);
    persist();
    set({
      plan: history.present,
      currentWallThickness: drawingThickness(
        history.present.meta.measurementSystem,
        get().wallThicknessPreset,
        get().currentWallThickness,
      ),
      selectedConnectionPoint: null,
      selectedLabels: new Set(),
      selectedFixtures: prunedIds(
        get().selectedFixtures,
        history.present.fixtures ?? [],
      ),
      labelEditor: null,
      selectedConnectionPointEndpoints: [],
      liveDragItems: null,
      liveDragConnectionPoint: null,
    });
  },
  marquee: null,
  setMarquee: (m) => set({ marquee: m }),
  loadPlan: (p) => {
    // Loading a document starts a fresh undo timeline.
    history = createHistory(p);
    persist();
    set({
      plan: history.present,
      currentWallThickness: drawingThickness(
        history.present.meta.measurementSystem,
        get().wallThicknessPreset,
        get().currentWallThickness,
      ),
      selectedWalls: new Set(),
      selectedItems: new Set(),
      selectedRoomPoint: null,
      selectedLabels: new Set(),
      selectedFixtures: new Set(),
      labelEditor: null,
      marquee: null,
      // Loading a document ends any in-progress drag; drop its pre-drag snapshot
      // so a stale one can't reconcile the new plan against the old doc's items.
      liveDragItems: null,
      liveDragConnectionPoint: null,
      // A held connection-point selection has no reliable meaning against a
      // freshly loaded plan (wall ids may collide with an unrelated junction
      // in the new doc), so drop it rather than risk a following nudge
      // dragging the wrong walls.
      selectedConnectionPoint: null,
      selectedConnectionPointEndpoints: [],
    });
  },
  translateSelection: (dx, dy) => {
    const state = get();
    if (state.liveDragItems) return;
    const { next, conflict } = translatePlanSelection(state, dx, dy);
    if (next === state.plan) return conflict;
    set(
      commit(
        {
          ...next,
          meta: { ...next.meta, updatedAt: new Date().toISOString() },
        },
        state,
      ),
    );
    return conflict;
  },
  translateSelectionLive: (dx, dy) => {
    const state = get();
    const { plan, liveDragItems } = state;
    const { next } = translatePlanSelection(state, dx, dy);
    if (next === plan) return;
    // Reconcile the pre-drag snapshot (if a gesture is in progress) against the
    // current live walls, so a mid-drag regrow restores removed items and exact
    // pre-drag offsets instead of compounding the previous tick's clamp/remove.
    set({
      plan:
        next.walls === plan.walls
          ? next
          : {
              ...next,
              ...previewMountedFixtures(next.walls),
              items: reconcileItemsToWalls(
                next.walls,
                liveDragItems ?? plan.items,
              ),
            },
    });
  },
  translateSelectedConnectionPoint: (dx, dy) => {
    const { plan, selectedConnectionPoint, selectedConnectionPointEndpoints } =
      get();
    if (!selectedConnectionPoint) return;
    const next: Plan = {
      ...plan,
      walls: translateEndpoints(
        plan.walls,
        selectedConnectionPointEndpoints,
        dx,
        dy,
      ),
      meta: { ...plan.meta, updatedAt: new Date().toISOString() },
    };
    // The nudge may have landed the point on another junction's coordinate,
    // welding them — commit() re-derives membership from the just-committed
    // plan, so a following nudge moves the whole welded junction instead of
    // silently un-welding it. It tracks the nudged coordinate, not the
    // pre-nudge one.
    set(
      commit(next, get(), {
        x: selectedConnectionPoint.x + dx,
        y: selectedConnectionPoint.y + dy,
      }),
    );
  },
  translateSelectedConnectionPointLive: (dx, dy) => {
    const {
      plan,
      selectedConnectionPoint,
      selectedConnectionPointEndpoints,
      liveDragItems,
    } = get();
    if (!selectedConnectionPoint) return;
    const walls = translateEndpoints(
      plan.walls,
      selectedConnectionPointEndpoints,
      dx,
      dy,
    );
    // Reconcile from the pre-drag snapshot (see translateSelectionLive).
    // Note: the drop-to-merge weld is not a separate step here — it falls out
    // of the data model (two walls are connected iff endpoints share a
    // coordinate), so landing the dragged endpoint on another junction's
    // coordinate at the final commit already welds them; only the live-preview
    // membership is fixed to the grab-time set.
    set({
      plan: {
        ...plan,
        walls,
        ...previewMountedFixtures(walls),
        items: reconcileItemsToWalls(walls, liveDragItems ?? plan.items),
      },
      selectedConnectionPoint: {
        x: selectedConnectionPoint.x + dx,
        y: selectedConnectionPoint.y + dy,
      },
    });
  },
  moveWallEndpointLive: (ref, target) => {
    const { plan, liveDragItems } = get();
    const wall = plan.walls.find((w) => w.id === ref.wallId);
    if (!wall) return;
    const cur = wall[ref.end];
    const dx = target.x - cur.x;
    const dy = target.y - cur.y;
    if (dx === 0 && dy === 0) return;
    // Reject a tick that would collapse the wall onto its other endpoint — the
    // same MIN_WALL_LENGTH guard drawing/resize use. Because targeting is
    // absolute, skipping this tick can't drift: the next tick recomputes the
    // delta from the wall's true current endpoint.
    const movedWall: Wall = { ...wall, [ref.end]: target };
    if (getWallLength(movedWall) < MIN_WALL_LENGTH) return;
    const walls = translateWallEndpoint(plan.walls, ref, dx, dy);
    // Reconcile the pre-drag item snapshot (if a gesture is in progress) against
    // the live walls, so attached openings keep their offsets / a mid-drag
    // regrow restores them (see translateSelectedConnectionPointLive).
    set({
      plan: {
        ...plan,
        walls,
        ...previewMountedFixtures(walls),
        items: reconcileItemsToWalls(walls, liveDragItems ?? plan.items),
      },
    });
  },
  liveDragItems: null,
  liveDragConnectionPoint: null,
  beginLiveDrag: () =>
    set({
      liveDragItems: get().plan.items,
      liveDragConnectionPoint: get().selectedConnectionPoint,
    }),
  endLiveDrag: () =>
    set({ liveDragItems: null, liveDragConnectionPoint: null }),
  // The live preview mutated `plan` without touching history, so the committed
  // present *is* the pre-drag plan — restoring it discards the preview. The
  // junction drag also advanced `selectedConnectionPoint`, so put that back from
  // the snapshot and re-derive its membership from the rolled-back walls, or the
  // selection would point at a coordinate the plan no longer has.
  cancelLiveDrag: () => {
    const { liveDragConnectionPoint } = get();
    set({
      plan: history.present,
      liveDragItems: null,
      liveDragConnectionPoint: null,
      selectedConnectionPoint: liveDragConnectionPoint,
      selectedConnectionPointEndpoints: liveDragConnectionPoint
        ? findConnectedEndpoints(history.present.walls, liveDragConnectionPoint)
        : [],
    });
  },
  commitPlan: () => {
    const { plan } = get();
    const committed = history.present;
    const next: Plan = {
      ...plan,
      // Rebase the original basin attachments when dropping a wall drag. A
      // live clamp must not hide the span from the split or merge that follows.
      ...(plan.walls !== committed.walls && committed.fixtures
        ? { fixtures: committed.fixtures }
        : {}),
      meta: { ...plan.meta, updatedAt: new Date().toISOString() },
    };
    // The gesture is over: the reconciled live items are now committed, so drop
    // the pre-drag snapshot before the next gesture captures a fresh one.
    // If a connection point is still selected (e.g. the drop welded it onto
    // another junction), commit() re-derives its membership from the
    // just-committed plan — otherwise a subsequent nudge would keep moving only
    // the grab-time set and silently un-weld the junction just created.
    set({
      ...commit(next, get()),
      liveDragItems: null,
      liveDragConnectionPoint: null,
    });
  },
}));
