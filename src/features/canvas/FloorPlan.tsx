import { fixtureConflictMessage } from "@app/fixtureMessage";
import {
  assertNever,
  type Fixture,
  type PlanLabel,
  type Point,
  type Wall,
} from "@app/schema";
import { useApp } from "@app/store";
import {
  type CanvasPoint,
  clampScale,
  computePinchView,
  type PinchAnchor,
} from "@app/viewport";
import {
  getConnectionPoints,
  pickAnyWallEndpoint,
  pickWallEndpoint,
  type WallEndpointRef,
} from "@geometry/connectivity";
import {
  dragFixtureMount,
  getFixtureConflict,
  getFixtureGeometry,
  hitFixture,
  MIN_SINK_TARGET_PX,
  pickFixtureMount,
  SINK_DEPTH,
  SINK_WIDTH,
} from "@geometry/fixtures";
import { hitConnectionPoint, hitItem, hitWall } from "@geometry/hit";
import { computeWallGeometry, paintedWallPolygons } from "@geometry/junction";
import {
  MIN_OPENING_WIDTH,
  openingPlacementFromOffsets,
} from "@geometry/opening";
import { planLabelRect } from "@geometry/planLabels";
import {
  pointInRect,
  rectFrom,
  rectsIntersect,
  segmentIntersectsRect,
} from "@geometry/rect";
import { layoutRoomLabels } from "@geometry/roomLabels";
import {
  detectRooms,
  findRoomAt,
  type Room,
  resolveRoomNames,
} from "@geometry/rooms";
import { applyInverseViewTransform, snapToGrid } from "@geometry/snap";
import {
  findNearestWall,
  getPointOnWall,
  getWallAngle,
  getWallLength,
  MIN_WALL_LENGTH,
} from "@geometry/wall";
import { wallDimensions } from "@geometry/wallDimensions";
import { createPlanLabelMeasurer } from "@ui/planLabelMeasurer";
import { createRoomLabelMeasurer } from "@ui/roomLabelMeasurer";
import clsx from "clsx";
import type React from "react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { uid } from "../../util/uid";
import { ConnectionPointsLayer } from "./ConnectionPointsLayer";
import { DimensionsLayer } from "./DimensionsLayer";
import { FixturesLayer, SinkPreview } from "./FixturesLayer";
import styles from "./FloorPlan.module.css";
import { GridLayer } from "./GridLayer";
import { InlineLabelEditor } from "./InlineLabelEditor";
import { ItemsLayer } from "./ItemsLayer";
import { MarqueeLayer } from "./MarqueeLayer";
import { PlanLabelsLayer } from "./PlanLabelsLayer";
import { RoomFocusLayer } from "./RoomFocusLayer";
import { RoomNameOptions } from "./RoomNameOptions";
import { RoomsLayer } from "./RoomsLayer";
import { SelectionLayer } from "./SelectionLayer";
import { WallEndpointsLayer } from "./WallEndpointsLayer";
import { WallResizePreview } from "./WallResizePreview";
import { WallsLayer } from "./WallsLayer";

type Opening = {
  type: "window" | "door";
  wallId: string;
  startOffset: number;
  currentOffset: number;
  thickness: number;
};

const TAP_THRESHOLD = 5; // CSS pixels, regardless of zoom

export function FloorPlan() {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const labelDraftLayer = useRef<SVGGElement>(null);
  const addWall = useApp((s) => s.addWall);
  const addItem = useApp((s) => s.addItem);
  const plan = useApp((s) => s.plan);
  const wallsById = useMemo(
    () => new Map(plan.walls.map((wall) => [wall.id, wall])),
    [plan.walls],
  );
  const tool = useApp((s) => s.tool);
  const view = useApp((s) => s.view);
  const setView = useApp((s) => s.setView);
  const isPanning = useApp((s) => s.isPanning);
  const setIsPanning = useApp((s) => s.setIsPanning);
  const selectedWalls = useApp((s) => s.selectedWalls);
  const selectedItems = useApp((s) => s.selectedItems);
  const selectWall = useApp((s) => s.selectWall);
  const selectItem = useApp((s) => s.selectItem);
  const selectConnectionPoint = useApp((s) => s.selectConnectionPoint);
  const selectNone = useApp((s) => s.selectNone);
  const selectRoom = useApp((s) => s.selectRoom);
  const selectedRoomPoint = useApp((s) => s.selectedRoomPoint);
  const selectedLabels = useApp((s) => s.selectedLabels);
  const selectedFixtures = useApp((s) => s.selectedFixtures);
  const selectFixture = useApp((s) => s.selectFixture);
  const labelEditor = useApp((s) => s.labelEditor);
  const selectLabels = useApp((s) => s.selectLabels);
  const setLabelEditor = useApp((s) => s.setLabelEditor);
  const marquee = useApp((s) => s.marquee);
  const setMarquee = useApp((s) => s.setMarquee);
  const canvasSize = useApp((s) => s.canvasSize);
  const hasLiveDrag = useApp((s) => s.liveDragItems !== null);

  const rooms = useMemo(() => detectRooms(plan.walls), [plan.walls]);
  const measurementSystem = plan.meta.measurementSystem;
  const wallGeometry = useMemo(
    () => computeWallGeometry(plan.walls),
    [plan.walls],
  );
  const paintedWalls = useMemo(
    () => paintedWallPolygons(wallGeometry),
    [wallGeometry],
  );
  const roomNames = useMemo(
    () => resolveRoomNames(rooms, plan.roomNames),
    [rooms, plan.roomNames],
  );
  const measureRoomText = useMemo(createRoomLabelMeasurer, []);
  const dimensions = useMemo(
    () => wallDimensions(plan.walls, measurementSystem, view.scale),
    [plan.walls, measurementSystem, view.scale],
  );
  const roomAnnotations = useMemo(
    () =>
      layoutRoomLabels({
        rooms,
        names: roomNames,
        walls: plan.walls,
        items: plan.items,
        system: measurementSystem,
        paintedWalls,
        dimensions,
        dimensionScale: view.scale,
        measure: measureRoomText,
      }),
    [
      rooms,
      roomNames,
      plan.walls,
      plan.items,
      measurementSystem,
      paintedWalls,
      dimensions,
      view.scale,
      measureRoomText,
    ],
  );
  const selectedRoom = selectedRoomPoint
    ? findRoomAt(rooms, selectedRoomPoint)
    : undefined;
  const [focusedRoomOutline, setFocusedRoomOutline] = useState<string | null>(
    null,
  );
  const roomTap = useRef(false);
  const fixturePress = useRef<{
    pointerId: number;
    start: Point;
    fixture?: Fixture;
  } | null>(null);
  const [fixturePointer, setFixturePointer] = useState<CanvasPoint | null>(
    null,
  );
  const [fixtureHint, setFixtureHint] = useState("");
  const labelPress = useRef<{
    pointerId: number;
    start: Point;
    label?: PlanLabel;
    editOnTap?: boolean;
    additive?: boolean;
  } | null>(null);
  const measureLabel = useMemo(createPlanLabelMeasurer, []);
  const labelFrames = useMemo(
    () =>
      plan.labels?.map((label) => ({
        label,
        rect: planLabelRect(label, measureLabel),
      })) ?? [],
    [plan.labels, measureLabel],
  );
  const editingLabel = labelEditor?.id
    ? plan.labels?.find((label) => label.id === labelEditor.id)
    : undefined;
  const roomNameInput = useRef<HTMLInputElement>(null);
  const focusRoomName = useRef(false);

  useLayoutEffect(() => {
    if (selectedRoom && focusRoomName.current) {
      focusRoomName.current = false;
      roomNameInput.current?.focus();
    }
  }, [selectedRoom]);

  const activateRoom = (room: Room) => {
    if (room === selectedRoom) roomNameInput.current?.focus();
    else {
      focusRoomName.current = true;
      selectRoom(room.labelPoint);
    }
  };

  const [drawingWall, setDrawingWall] = useState<Point | null>(null);
  const [cursor, setCursor] = useState<Point | null>(null);
  const [opening, setOpening] = useState<Opening | null>(null);
  const [dragging, setDragging] = useState<boolean>(false);
  const selectionDrag = useRef<{
    start: Point;
    applied: Point;
    snap: boolean;
    threshold: number;
  } | null>(null);
  const [movingPoint, setMovingPoint] = useState<null | {
    start: Point; // pointer position where drag began
    last: Point; // last applied pointer position
    snap: boolean; // snap-to-grid on this drag
  }>(null);
  // Dragging a single wall's endpoint (detach-from-junction). Driven by an
  // absolute target each tick (see moveWallEndpointLive), so we only need the
  // grab-time anchors, not an accumulated `last`.
  const [movingEndpoint, setMovingEndpoint] = useState<null | {
    ref: WallEndpointRef;
    startCoord: Point; // the endpoint's coordinate at grab time
    grabWorld: Point; // pointer world position at grab time
    snap: boolean; // snap-to-grid on this drag
  }>(null);

  // Every contact currently down on the canvas, in canvas-local pixels, keyed by
  // pointerId. Touch means several at once, so we track them instead of assuming
  // a single pointer. Refs, not state: the pointer handlers read and write these
  // on every move and must never be a render behind.
  const pointers = useRef(new Map<number, CanvasPoint>());
  // The live two-finger gesture: which contacts drive it, and the anchor its
  // pan/zoom is derived from.
  const pinch = useRef<{ ids: [number, number]; anchor: PinchAnchor } | null>(
    null,
  );
  // Set the moment a gesture becomes multi-touch, cleared when the last finger
  // lifts. Keeps a leftover finger from resuming the tool gesture that the
  // second finger abandoned.
  const multiTouch = useRef(false);

  // biome-ignore lint/correctness/useExhaustiveDependencies: Clear the preview and hint when the active tool changes.
  useEffect(() => {
    setFixturePointer(null);
    setFixtureHint("");
  }, [tool]);

  useEffect(() => {
    const resize = () => {
      const el = svgRef.current;
      if (!el) return;
      useApp.getState().setCanvasSize({
        width: el.clientWidth,
        height: el.clientHeight,
      });
    };
    resize();
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, []);

  useEffect(() => {
    const del = useApp.getState().deleteSelected;
    const nudge = useApp.getState().nudgeSelectedWallThickness;
    const toggleHinge = useApp.getState().toggleSelectedDoorHingeEdge;
    const toggleSwing = useApp.getState().toggleSelectedDoorSwingSide;

    const nudgeSelection = (dx: number, dy: number) => {
      const state = useApp.getState();
      if (state.selectedConnectionPoint) {
        state.translateSelectedConnectionPoint(dx, dy);
      } else {
        const conflict = state.translateSelection(dx, dy);
        if (state.selectedFixtures.size)
          setFixtureHint(conflict ? fixtureConflictMessage[conflict] : "");
      }
    };

    const onKey = (e: KeyboardEvent) => {
      // A disabled dialog button can leave keyboard focus on the document.
      // Keep canvas shortcuts suspended for the entire modal session.
      if (document.querySelector("dialog[open]")) return;

      // Don't hijack keys while typing into a form field.
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.isContentEditable ||
          ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))
      ) {
        return;
      }

      // Platform-aware undo/redo. Treat Cmd (macOS) or Ctrl (Win/Linux) as the
      // trigger modifier. Any other modifier+key combo returns early so the
      // single-letter cases below (h, s, [, ], arrows) don't fire while a
      // modifier is held (e.g. Cmd+S must not toggle a door swing).
      if (e.metaKey || e.ctrlKey) {
        const key = e.key.toLowerCase();
        if (key === "z") {
          if (e.shiftKey) {
            useApp.getState().redo();
          } else {
            useApp.getState().undo();
          }
          e.preventDefault();
        } else if (key === "y") {
          useApp.getState().redo();
          e.preventDefault();
        }
        return;
      }

      // Read grid size lazily so it stays current if the plan changes.
      const grid = useApp.getState().plan.meta.gridSize;
      const base = e.shiftKey ? 10 : 1;
      const step = e.altKey ? 1 : grid; // Alt = raw 1 unit, else snap to grid

      switch (e.key.toLowerCase()) {
        case "escape":
          if (
            useApp.getState().selectedRoomPoint ||
            useApp.getState().selectedLabels.size ||
            useApp.getState().selectedFixtures.size ||
            useApp.getState().labelEditor
          )
            useApp.getState().selectNone();
          if (
            (selectionDrag.current || fixturePress.current?.fixture) &&
            useApp.getState().liveDragItems
          )
            useApp.getState().cancelLiveDrag();
          labelPress.current = null;
          fixturePress.current = null;
          setFixturePointer(null);
          setFixtureHint("");
          selectionDrag.current = null;
          setDrawingWall(null);
          setOpening(null);
          setDragging(false);
          setMovingPoint(null);
          setMovingEndpoint(null);
          break;
        case "delete":
        case "backspace":
          del();
          break;
        case "[":
          nudge(-1);
          break;
        case "]":
          nudge(+1);
          break;
        case "h":
          toggleHinge();
          break;
        case "s":
          toggleSwing();
          break;
        case "arrowup":
          nudgeSelection(0, -base * step);
          break;
        case "arrowdown":
          nudgeSelection(0, base * step);
          break;
        case "arrowleft":
          nudgeSelection(-base * step, 0);
          break;
        case "arrowright":
          nudgeSelection(base * step, 0);
          break;
        default:
          return;
      }
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const toWorld = (clientX: number, clientY: number) => {
    return applyInverseViewTransform(
      clientX,
      clientY,
      svgRef.current!,
      view.panX,
      view.panY,
      view.scale,
    );
  };

  // Pointer position in canvas-local pixels — the space `panX`/`panY` and the
  // pinch math work in (see computePinchView).
  const toCanvas = (clientX: number, clientY: number): CanvasPoint => {
    const rect = svgRef.current!.getBoundingClientRect();
    return { x: clientX - rect.left, y: clientY - rect.top };
  };

  // (Re-)anchor the two-finger gesture on the first two contacts at their
  // current positions and the current viewport. Re-anchoring instead of keeping
  // the original anchor is what stops the view jumping when the driving pair
  // changes (a third finger lands, or one of the two lifts while others remain).
  const anchorPinch = () => {
    const [first, second] = [...pointers.current.entries()];
    if (!first || !second) {
      pinch.current = null;
      return;
    }
    pinch.current = {
      ids: [first[0], second[0]],
      anchor: { a: first[1], b: second[1], view: useApp.getState().view },
    };
  };

  // Abandon whatever tool gesture is in flight without committing anything:
  // drop the drafts and roll back a live drag's preview. Shared by
  // `pointercancel` (the browser took the gesture away) and by the second finger
  // landing, which turns the gesture into a pan/pinch. The live-drag check reads
  // the store rather than React state so it holds even when two contacts arrive
  // before a re-render.
  const abortGesture = () => {
    if (useApp.getState().liveDragItems) useApp.getState().cancelLiveDrag();
    roomTap.current = false;
    labelPress.current = null;
    fixturePress.current = null;
    setFixturePointer(null);
    setFixtureHint("");
    selectionDrag.current = null;
    setMovingPoint(null);
    setMovingEndpoint(null);
    setDrawingWall(null);
    setOpening(null);
    setDragging(false);
    setMarquee(null);
    setIsPanning(false);
  };

  const startSelectionDrag = (world: Point, snap: boolean, threshold = 0) => {
    selectionDrag.current = {
      start: world,
      applied: { x: 0, y: 0 },
      snap,
      threshold,
    };
    useApp.getState().beginLiveDrag();
  };

  const moveSelectionDrag = (world: Point) => {
    const drag = selectionDrag.current;
    const state = useApp.getState();
    if (!drag || !state.liveDragItems) return;
    const delta = {
      x: world.x - drag.start.x,
      y: world.y - drag.start.y,
    };
    const target =
      Math.hypot(delta.x, delta.y) * view.scale <= drag.threshold
        ? { x: 0, y: 0 }
        : drag.snap
          ? snapToGrid(delta, plan.meta.gridSize)
          : delta;
    const dx = target.x - drag.applied.x;
    const dy = target.y - drag.applied.y;
    if (dx === 0 && dy === 0) return;
    state.translateSelectionLive(dx, dy);
    drag.applied = target;
  };

  const finishSelectionDrag = () => {
    const drag = selectionDrag.current;
    selectionDrag.current = null;
    const state = useApp.getState();
    if (!drag || !state.liveDragItems) return false;
    if (
      state.tool === "select" &&
      (drag.applied.x !== 0 || drag.applied.y !== 0)
    )
      state.commitPlan();
    else state.cancelLiveDrag();
    return true;
  };

  const fixtureProposalAt = (world: Point) => {
    const minTargetSize = MIN_SINK_TARGET_PX / view.scale;
    const press = fixturePress.current;
    if (tool === "sink") {
      const mount = pickFixtureMount(
        world,
        plan.walls,
        SINK_WIDTH,
        SINK_DEPTH,
        minTargetSize,
      );
      return mount && { mount, depth: SINK_DEPTH };
    }
    if (
      tool !== "select" ||
      !press?.fixture ||
      !hasLiveDrag ||
      Math.hypot(world.x - press.start.x, world.y - press.start.y) *
        view.scale <=
        TAP_THRESHOLD
    )
      return null;
    const mount = dragFixtureMount(
      world,
      press.start,
      press.fixture,
      plan.walls,
      minTargetSize,
    );
    return mount && { mount, depth: press.fixture.depth };
  };

  // Build and commit an opening item from a resolved offset/length. Shared by
  // both creation gestures (click-click and drag) so they produce identical
  // items given the same placement.
  const commitOpening = (o: Opening, offset: number, length: number) => {
    switch (o.type) {
      case "window":
        addItem({
          id: uid(o.type),
          type: o.type,
          wallAttach: { wallId: o.wallId, offset, length },
          thickness: o.thickness,
          props: {},
        });
        break;
      case "door":
        addItem({
          id: uid(o.type),
          type: o.type,
          wallAttach: { wallId: o.wallId, offset, length },
          thickness: o.thickness,
          props: { hingeEdge: "start", swingSide: "outside" },
        });
        break;
      default:
        assertNever(o as never); // TS forces to handle new kinds later
    }
  };

  // Arm a single-wall-endpoint drag (detach). Shared by the select-first
  // handle grab and the Cmd/Ctrl accelerator so both produce the same gesture.
  const beginEndpointDrag = (
    ref: WallEndpointRef,
    startCoord: Point,
    grabWorld: Point,
    snap: boolean,
  ) => {
    setMovingEndpoint({ ref, startCoord, grabWorld, snap });
    useApp.getState().beginLiveDrag();
  };

  const onPointerDown: React.PointerEventHandler<SVGSVGElement> = (e) => {
    if (!svgRef.current) return;
    // Capture on the <svg> itself (currentTarget), not e.target — a clicked
    // child (e.g. a wall <polygon>) can re-render mid-drag and drop the capture.
    e.currentTarget.setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, toCanvas(e.clientX, e.clientY));

    // Two or more contacts means pan/pinch, whatever the tool is — so you never
    // have to switch to the Pan tool to move around. The one-finger gesture the
    // first contact started is abandoned rather than committed as a garbage edit.
    if (pointers.current.size >= 2) {
      if (!multiTouch.current) {
        multiTouch.current = true;
        abortGesture();
      }
      anchorPinch();
      return;
    }

    if (e.button === 2 || tool === "pan") {
      setFixturePointer(null);
      setFixtureHint("");
      setIsPanning(true);
      return;
    }

    const world = toWorld(e.clientX, e.clientY);
    const additive = e.shiftKey;
    setFixtureHint("");

    if (tool === "label" && e.button === 0) {
      labelPress.current = { pointerId: e.pointerId, start: world };
      return;
    }

    if (tool === "sink" && e.button === 0) {
      fixturePress.current = { pointerId: e.pointerId, start: world };
      setFixturePointer(toCanvas(e.clientX, e.clientY));
      return;
    }

    if (tool === "select") {
      const hitLabel =
        e.button === 0 &&
        labelFrames.findLast(({ rect }) => {
          const pad = (e.pointerType === "touch" ? 10 : 2) / view.scale;
          return pointInRect(world, {
            x: rect.x - pad,
            y: rect.y - pad,
            w: rect.w + 2 * pad,
            h: rect.h + 2 * pad,
          });
        });
      if (hitLabel) {
        const { label } = hitLabel;
        const alreadySelected = selectedLabels.has(label.id);
        const editOnTap =
          alreadySelected &&
          !additive &&
          selectedLabels.size === 1 &&
          selectedWalls.size === 0 &&
          selectedItems.size === 0 &&
          selectedFixtures.size === 0;
        if (!alreadySelected) selectLabels([label.id], additive);
        labelPress.current = {
          pointerId: e.pointerId,
          start: world,
          label,
          editOnTap,
          additive,
        };
        startSelectionDrag(
          world,
          !e.altKey && useApp.getState().selectedWalls.size > 0,
          TAP_THRESHOLD,
        );
        return;
      }

      const fixture =
        e.button === 0 &&
        plan.fixtures?.findLast((item) => {
          const wall = wallsById.get(item.wallAttach.wallId);
          return (
            wall &&
            hitFixture(
              world,
              item,
              wall,
              (e.pointerType === "touch" ? 10 : 2) / view.scale,
            )
          );
        });
      if (fixture) {
        if (!selectedFixtures.has(fixture.id) || !additive)
          selectFixture(fixture.id, additive);
        fixturePress.current = {
          pointerId: e.pointerId,
          start: world,
          fixture,
        };
        useApp.getState().beginLiveDrag();
        return;
      }

      // test items first
      const hitI = [...plan.items].findLast((i) => {
        const w = plan.walls.find((w) => w.id === i.wallAttach.wallId);
        return w ? hitItem(world, i, w, 6) : false;
      });
      if (hitI) {
        selectItem(hitI.id, additive);
        return;
      }

      // then, when exactly one wall is selected, its own endpoint handles —
      // grabbing one detaches just that wall's end from any junction. Tested
      // before connection points so an endpoint sitting on a junction grabs the
      // single-wall handle (the reason the wall was selected) over the shared one.
      if (selectedWalls.size === 1) {
        const [selId] = selectedWalls;
        const selWall = plan.walls.find((w) => w.id === selId);
        const end = selWall ? pickWallEndpoint(selWall, world, 10) : null;
        if (selWall && end) {
          beginEndpointDrag(
            { wallId: selWall.id, end },
            selWall[end],
            world,
            !e.altKey,
          );
          return;
        }
      }

      // Cmd/Ctrl accelerator: detach the nearest endpoint of *any* wall without
      // selecting it first. Tested before connection points and walls so it
      // wins over starting a junction/wall drag. At a shared junction it detaches
      // the topmost wall (see `pickAnyWallEndpoint`); only a genuinely ambiguous
      // grab (endpoints equidistant but at different spots) reports a tie and
      // falls through, where the user disambiguates via the select-first handles.
      if (e.metaKey || e.ctrlKey) {
        const pick = pickAnyWallEndpoint(plan.walls, world, 10);
        if (pick.kind === "hit") {
          const wall = plan.walls.find((w) => w.id === pick.ref.wallId);
          if (wall) {
            // Keep the OS/browser out of it (text selection, drag-start, the
            // macOS Ctrl+click menu) now that the gesture is ours.
            e.preventDefault();
            beginEndpointDrag(pick.ref, wall[pick.ref.end], world, !e.altKey);
            return;
          }
        }
      }

      // then connection points (corner/junction handles)
      const hitP = getConnectionPoints(plan.walls).find((p) =>
        hitConnectionPoint(world, p, 10),
      );
      if (hitP) {
        selectConnectionPoint(hitP);
        setMovingPoint({
          start: world,
          last: world,
          snap: !e.altKey,
        });
        useApp.getState().beginLiveDrag();
        return;
      }

      // then walls
      const hitW = [...plan.walls].findLast((w) => hitWall(world, w, 6));
      if (hitW) {
        // Select first, then snapshot: `selectWall` clears any connection-point
        // selection, and `beginLiveDrag` records the selection as it stands so
        // an abandoned drag restores *this* gesture's state — snapshotting first
        // would resurrect the junction on top of the wall selection.
        // (`beginLiveDrag` only reads `plan.items`, which `selectWall` leaves alone.)
        if (!selectedWalls.has(hitW.id)) selectWall(hitW.id, additive);
        startSelectionDrag(world, !e.altKey);
        return;
      }

      // An interior tap selects a room, while a drag can marquee from the same spot.
      roomTap.current = !additive && Boolean(findRoomAt(rooms, world));
      setMarquee({ x0: world.x, y0: world.y, x1: world.x, y1: world.y });

      if (!additive && !roomTap.current) selectNone();
      return;
    }

    if (tool === "wall") {
      const snapped = snapToGrid(world, plan.meta.gridSize);
      if (drawingWall) {
        const w: Wall = {
          id: uid("wall"),
          a: drawingWall,
          b: snapped,
          thickness: useApp.getState().currentWallThickness,
        };
        if (getWallLength(w) >= MIN_WALL_LENGTH) addWall(w);
      }
      // chain wall drawing
      setDrawingWall(snapped);
      return;
    }

    if (tool === "window" || tool === "door") {
      const near = findNearestWall(world, plan.walls, 30); // 30 units tolerance
      if (!near) return; // click ignored if not near any wall
      const startOffset =
        Math.round(near.offset / plan.meta.gridSize) * plan.meta.gridSize;
      if (!opening) {
        setOpening({
          type: tool,
          wallId: near.wall.id,
          startOffset,
          currentOffset: startOffset,
          thickness: near.wall.thickness + 8, // +8cm for visual thickness
        });
      } else {
        // finalize (click-click): clamp up to the minimum width, so a second
        // click at (or near) the start still produces a real opening.
        if (opening.wallId !== near.wall.id) return; // force same wall for now
        const offset = Math.min(opening.startOffset, startOffset);
        const length = Math.max(
          MIN_OPENING_WIDTH,
          Math.abs(startOffset - opening.startOffset),
        );
        commitOpening(opening, offset, length);
        setOpening(null);
      }
      return;
    }
  };

  const onPointerMove: React.PointerEventHandler<SVGSVGElement> = (e) => {
    if (!svgRef.current) return;
    // Track the contact's new position before anything reads it, keeping its
    // previous one to derive a delta from.
    const previous = pointers.current.get(e.pointerId);
    const local = toCanvas(e.clientX, e.clientY);
    if (previous) pointers.current.set(e.pointerId, local);

    if (pinch.current) {
      const [idA, idB] = pinch.current.ids;
      const a = pointers.current.get(idA);
      const b = pointers.current.get(idB);
      const anchor = pinch.current.anchor;
      if (a && b) setView(() => computePinchView(anchor, a, b));
      return;
    }
    // A finger left over from a multi-touch gesture must not start drawing.
    if (multiTouch.current) return;

    const world = toWorld(e.clientX, e.clientY);
    setCursor(world);
    const basinPress = fixturePress.current;
    if (basinPress?.pointerId === e.pointerId && basinPress.fixture) {
      if (e.buttons === 1 && tool === "select") setFixturePointer(local);
      return;
    }
    if (
      tool === "sink" &&
      !isPanning &&
      (e.pointerType !== "touch" || basinPress?.pointerId === e.pointerId)
    ) {
      setFixturePointer(local);
      setFixtureHint("");
      return;
    }
    const press = labelPress.current;
    if (press?.pointerId === e.pointerId) {
      if (press.label && tool === "select") moveSelectionDrag(world);
      return;
    }
    if (e.buttons === 1 && tool === "select" && selectionDrag.current) {
      moveSelectionDrag(world);
      return;
    }
    if (marquee) {
      setMarquee({ ...marquee, x1: world.x, y1: world.y });
      return;
    }
    if (isPanning && previous) {
      // Pan by the contact's own delta rather than `movementX/movementY`, which
      // browsers only populate for mouse pointers — a finger reports zero.
      const dx = local.x - previous.x;
      const dy = local.y - previous.y;
      setView((v) => ({ ...v, panX: v.panX + dx, panY: v.panY + dy }));
    }

    // start dragging (wall creation, or opening creation along a wall)
    if (
      e.buttons === 1 &&
      (tool === "wall" || tool === "window" || tool === "door")
    ) {
      setDragging(true);
    }

    // start moving a single wall's endpoint (detach). Drive an absolute target
    // from the grab anchors so the preview is drift-free even if a tick is
    // rejected by the zero-length guard.
    if (e.buttons === 1 && tool === "select" && movingEndpoint) {
      const state = useApp.getState();
      if (!state.liveDragItems) return;
      let tx =
        movingEndpoint.startCoord.x + (world.x - movingEndpoint.grabWorld.x);
      let ty =
        movingEndpoint.startCoord.y + (world.y - movingEndpoint.grabWorld.y);
      if (movingEndpoint.snap) {
        const grid = plan.meta.gridSize;
        tx = Math.round(tx / grid) * grid;
        ty = Math.round(ty / grid) * grid;
      }
      state.moveWallEndpointLive(movingEndpoint.ref, { x: tx, y: ty });
      return;
    }

    // start moving a connection point
    if (e.buttons === 1 && tool === "select" && movingPoint) {
      const state = useApp.getState();
      if (!state.liveDragItems) return;
      const world = toWorld(e.clientX, e.clientY);
      const dx = world.x - movingPoint.last.x;
      const dy = world.y - movingPoint.last.y;

      if (dx !== 0 || dy !== 0) {
        let tdx = dx,
          tdy = dy;

        if (movingPoint.snap) {
          const grid = plan.meta.gridSize;
          const totalDx = world.x - movingPoint.start.x;
          const totalDy = world.y - movingPoint.start.y;
          const snappedDx = Math.round(totalDx / grid) * grid;
          const snappedDy = Math.round(totalDy / grid) * grid;
          tdx = snappedDx - (movingPoint.last.x - movingPoint.start.x);
          tdy = snappedDy - (movingPoint.last.y - movingPoint.start.y);
        }

        state.translateSelectedConnectionPointLive(tdx, tdy);
        setMovingPoint({
          ...movingPoint,
          last: {
            x: movingPoint.last.x + tdx,
            y: movingPoint.last.y + tdy,
          },
        });
      }
      return;
    }

    // update preview for openings
    if (opening && (tool === "window" || tool === "door")) {
      const near = findNearestWall(world, plan.walls, 30);
      if (!near || near.wall.id !== opening.wallId) return;
      const next =
        Math.round(near.offset / plan.meta.gridSize) * plan.meta.gridSize;
      setOpening({ ...opening, currentOffset: next });
    }
  };

  // Forget a lifted/cancelled contact and re-settle the multi-touch state:
  // re-anchor while two contacts remain (so the view doesn't jump when the
  // driving pair changes), otherwise end the pinch. Returns true if the event
  // belonged to a multi-touch gesture, i.e. no tool gesture should act on it.
  const releasePointer = (pointerId: number): boolean => {
    pointers.current.delete(pointerId);
    if (pointers.current.size >= 2) anchorPinch();
    else pinch.current = null;
    const wasMultiTouch = multiTouch.current;
    if (pointers.current.size === 0) multiTouch.current = false;
    return wasMultiTouch;
  };

  const onPointerUp: React.PointerEventHandler<SVGSVGElement> = (e) => {
    if (!svgRef.current) return;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    if (releasePointer(e.pointerId)) return;
    if (isPanning) setIsPanning(false);
    const basinPress = fixturePress.current;
    if (basinPress?.pointerId === e.pointerId) {
      const world = toWorld(e.clientX, e.clientY);
      const proposal = fixtureProposalAt(world);
      fixturePress.current = null;
      const state = useApp.getState();
      if (basinPress.fixture) {
        setFixturePointer(null);
        if (!state.liveDragItems) return;
        state.endLiveDrag();
        const conflict =
          tool === "select" &&
          proposal &&
          state.moveFixture(basinPress.fixture.id, proposal.mount);
        if (conflict) setFixtureHint(fixtureConflictMessage[conflict]);
      } else if (
        tool === "sink" &&
        (e.pointerType === "touch" ||
          Math.hypot(
            world.x - basinPress.start.x,
            world.y - basinPress.start.y,
          ) *
            view.scale <=
            TAP_THRESHOLD)
      ) {
        if (!proposal) {
          setFixturePointer(null);
          setFixtureHint("Point closer to a wall face to place the sink.");
        } else {
          const conflict = state.placeFixture(proposal.mount);
          setFixturePointer(conflict ? toCanvas(e.clientX, e.clientY) : null);
          if (conflict) setFixtureHint(fixtureConflictMessage[conflict]);
        }
      }
      return;
    }
    const press = labelPress.current;
    if (press?.pointerId === e.pointerId) {
      labelPress.current = null;
      const world = toWorld(e.clientX, e.clientY);
      const dx = world.x - press.start.x;
      const dy = world.y - press.start.y;
      const moved = Math.hypot(dx, dy) * view.scale > TAP_THRESHOLD;
      if (press.label) {
        if (tool === "select") moveSelectionDrag(world);
        if (!finishSelectionDrag() || tool !== "select" || moved) return;
        if (press.editOnTap) {
          const { id, position } = press.label;
          // Mount and focus the editor during the pointer gesture.
          flushSync(() => setLabelEditor({ id, position }));
        } else if (!press.additive) {
          selectLabels([press.label.id]);
        }
      } else if (!moved && tool === "label") {
        flushSync(() => setLabelEditor({ position: world }));
      }
      return;
    }
    if (dragging && drawingWall && tool === "wall") {
      const world = toWorld(e.clientX, e.clientY);
      const snapped = snapToGrid(world, plan.meta.gridSize);
      const w: Wall = {
        id: uid("wall"),
        a: drawingWall,
        b: snapped,
        thickness: useApp.getState().currentWallThickness,
      };
      if (getWallLength(w) >= MIN_WALL_LENGTH) addWall(w);
      setDrawingWall(null);
      setDragging(false);
    }
    // Opening drag finalize: press → drag along a wall → release makes one
    // opening in a single gesture. A press-release with no move never sets
    // `dragging`, so it falls through to the click-click path (opening stays
    // "started" for a second click). `currentOffset` already tracks the live
    // preview on the starting wall, so the created opening matches the preview.
    if (dragging && (tool === "window" || tool === "door")) {
      if (opening) {
        const placement = openingPlacementFromOffsets(
          opening.startOffset,
          opening.currentOffset,
        );
        if (placement) {
          commitOpening(opening, placement.offset, placement.length);
        }
        setOpening(null);
      }
      setDragging(false);
      return;
    }
    if (marquee) {
      const canSelectRoom = roomTap.current;
      roomTap.current = false;
      const world = toWorld(e.clientX, e.clientY);
      if (canSelectRoom) {
        const room = findRoomAt(rooms, { x: marquee.x0, y: marquee.y0 });
        if (
          tool === "select" &&
          room &&
          Math.hypot(world.x - marquee.x0, world.y - marquee.y0) * view.scale <=
            5 &&
          findRoomAt(rooms, world) === room
        ) {
          selectRoom(room.labelPoint);
          setMarquee(null);
          return;
        }
        selectNone();
      }
      const r = rectFrom(marquee.x0, marquee.y0, world.x, world.y);
      // select items
      for (const item of plan.items) {
        const wall = plan.walls.find((w) => w.id === item.wallAttach.wallId);
        if (!wall) continue;
        const mid = item.wallAttach.offset + item.wallAttach.length / 2;
        const center = getPointOnWall(wall, mid);
        if (pointInRect(center, r)) selectItem(item.id, true);
      }
      // select walls
      for (const wall of plan.walls) {
        if (segmentIntersectsRect(wall.a, wall.b, r)) selectWall(wall.id, true);
      }
      for (const fixture of plan.fixtures ?? []) {
        const wall = wallsById.get(fixture.wallAttach.wallId);
        if (wall && pointInRect(getFixtureGeometry(fixture, wall).center, r))
          selectFixture(fixture.id, true);
      }
      const labels = labelFrames.filter(({ rect }) => rectsIntersect(rect, r));
      if (labels.length)
        selectLabels(
          labels.map(({ label }) => label.id),
          true,
        );
      setMarquee(null);
      return;
    }
    if (selectionDrag.current) {
      finishSelectionDrag();
      return;
    }
    if ((movingPoint || movingEndpoint) && !useApp.getState().liveDragItems) {
      setMovingPoint(null);
      setMovingEndpoint(null);
      return;
    }
    if (movingPoint) {
      // Same live-drag-then-commit pattern as whole-wall moves.
      const moved =
        movingPoint.last.x !== movingPoint.start.x ||
        movingPoint.last.y !== movingPoint.start.y;
      if (moved) useApp.getState().commitPlan();
      else useApp.getState().endLiveDrag();
      setMovingPoint(null);
      return;
    }
    if (movingEndpoint) {
      // Same live-drag-then-commit pattern; the endpoint's live coordinate tells
      // us whether it actually moved (a rejected/no-op drag never committed).
      const wall = plan.walls.find((w) => w.id === movingEndpoint.ref.wallId);
      const cur = wall?.[movingEndpoint.ref.end];
      const moved =
        !!cur &&
        (cur.x !== movingEndpoint.startCoord.x ||
          cur.y !== movingEndpoint.startCoord.y);
      if (moved) useApp.getState().commitPlan();
      else useApp.getState().endLiveDrag();
      setMovingEndpoint(null);
      return;
    }
  };

  // The browser took the gesture away mid-drag (a system gesture, the contact
  // going out of range). Nothing is committed: drafts vanish and a live drag is
  // rolled back, so the canvas isn't left half-dragging.
  const onPointerCancel: React.PointerEventHandler<SVGSVGElement> = (e) => {
    if (!svgRef.current) return;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    if (releasePointer(e.pointerId)) return;
    abortGesture();
  };

  const onWheel: React.WheelEventHandler<SVGSVGElement> = (e) => {
    const delta = -e.deltaY;
    const factor = Math.exp(delta * 0.001);
    const worldBefore = toWorld(e.clientX, e.clientY);
    setView((v) => {
      const newScale = clampScale(v.scale * factor, v.minScale);
      const rect = svgRef.current!.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;
      const worldAfterX = (sx - v.panX) / newScale;
      const worldAfterY = (sy - v.panY) / newScale;
      const dx = (worldAfterX - worldBefore.x) * newScale;
      const dy = (worldAfterY - worldBefore.y) * newScale;
      return { ...v, scale: newScale, panX: v.panX + dx, panY: v.panY + dy };
    });
  };

  const viewTransform = `translate(${view.panX} ${view.panY}) scale(${view.scale})`;

  const fixtureProposal =
    fixturePointer &&
    fixtureProposalAt({
      x: (fixturePointer.x - view.panX) / view.scale,
      y: (fixturePointer.y - view.panY) / view.scale,
    });
  const previewFixture = fixtureProposal && {
    ...fixtureProposal.mount,
    depth: fixtureProposal.depth,
  };
  const previewHost =
    previewFixture && wallsById.get(previewFixture.wallAttach.wallId);
  const previewConflict =
    previewFixture &&
    previewHost &&
    getFixtureConflict(previewFixture, previewHost, plan.items, paintedWalls);
  const activeFixtureHint = previewConflict
    ? fixtureConflictMessage[previewConflict]
    : fixtureHint;

  const wallPreview = (() => {
    if (tool !== "wall" || !drawingWall || !cursor) return null;
    const snapped = snapToGrid(cursor, plan.meta.gridSize);
    return (
      <line
        x1={drawingWall.x}
        y1={drawingWall.y}
        x2={snapped.x}
        y2={snapped.y}
        stroke="var(--sp-accent)"
        strokeDasharray="6 4"
        strokeWidth={2}
      />
    );
  })();

  const openingPreview = (() => {
    if (!opening) return null;
    const wall = plan.walls.find((w) => w.id === opening.wallId);
    if (!wall) return null;
    const a = Math.min(opening.startOffset, opening.currentOffset);
    const b = Math.max(opening.startOffset, opening.currentOffset);
    const mid = (a + b) / 2;
    const c = getPointOnWall(wall, mid);
    const angle = getWallAngle(wall);
    return (
      <rect
        x={c.x - (b - a) / 2}
        y={c.y - opening.thickness / 2}
        width={Math.max(2, b - a)}
        height={opening.thickness}
        transform={`rotate(${(angle * 180) / Math.PI}, ${c.x}, ${c.y})`}
        fill="none"
        stroke="var(--sp-accent)"
        strokeDasharray="6 4"
        strokeWidth={2}
      />
    );
  })();

  return (
    <>
      <svg
        className={clsx(
          styles.floorplan,
          tool === "select" &&
            (hasLiveDrag &&
            (selectionDrag.current || fixturePress.current?.fixture)
              ? styles.moving
              : styles.select),
        )}
        ref={svgRef}
        onContextMenu={(e) => e.preventDefault()}
        onPointerDown={onPointerDown}
        onPointerLeave={() => {
          if (!fixturePress.current) setFixturePointer(null);
        }}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        onWheel={onWheel}
      >
        <title>Floor plan canvas</title>
        <g transform={viewTransform}>
          <GridLayer width={canvasSize.width} height={canvasSize.height} />
          <RoomsLayer
            annotations={roomAnnotations}
            selectedRoom={selectedRoom}
            activateRoom={activateRoom}
            onRoomFocus={setFocusedRoomOutline}
          />
          <WallsLayer geometry={wallGeometry} />
          <ItemsLayer />
          <FixturesLayer
            fixtures={plan.fixtures}
            wallsById={wallsById}
            selectedIds={selectedFixtures}
            hiddenId={
              previewHost ? fixturePress.current?.fixture?.id : undefined
            }
          />
          <DimensionsLayer dimensions={dimensions} scale={view.scale} />
          <SelectionLayer />
          {tool === "select" && focusedRoomOutline && (
            <RoomFocusLayer outline={focusedRoomOutline} />
          )}
          <ConnectionPointsLayer />
          <WallEndpointsLayer />
          <WallResizePreview />
          <PlanLabelsLayer
            frames={labelFrames}
            selectedIds={selectedLabels}
            editingId={editingLabel?.id}
          />
          {/* biome-ignore lint/a11y/noAriaHiddenOnFocusable: The SVG preview has no tab stop or pointer events. The editor exposes its text. */}
          <g
            ref={labelDraftLayer}
            data-layer="label-edit-preview"
            pointerEvents="none"
            focusable="false"
            aria-hidden="true"
          />
          <MarqueeLayer />
          {wallPreview}
          {openingPreview}
          {previewFixture && previewHost && (
            <SinkPreview
              footprint={previewFixture}
              wall={previewHost}
              blocked={Boolean(previewConflict)}
            />
          )}
        </g>
      </svg>
      {activeFixtureHint && (
        <div className={styles.fixtureHint} role="status">
          {activeFixtureHint}
        </div>
      )}
      {tool === "select" && selectedRoom && (
        <RoomNameOptions
          key={`${selectedRoom.labelPoint.x},${selectedRoom.labelPoint.y}`}
          name={roomNames.get(selectedRoom)?.name ?? ""}
          inputRef={roomNameInput}
        />
      )}
      {labelEditor && (
        <InlineLabelEditor
          key={editingLabel ? `edit:${editingLabel.id}` : "new"}
          position={labelEditor.position}
          text={editingLabel?.text}
          view={view}
          measure={measureLabel}
          previewLayer={labelDraftLayer.current}
        />
      )}
      <div className={styles.badge}>
        Tool: {tool} • Scale: {view.scale.toFixed(2)} • Pan: (
        {view.panX.toFixed(0)}, {view.panY.toFixed(0)})
      </div>
    </>
  );
}
