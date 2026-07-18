import { assertNever, type Point, type Wall } from "@app/schema";
import { useApp } from "@app/store";
import { clampScale } from "@app/viewport";
import {
  getConnectionPoints,
  pickWallEndpoint,
  type WallEndpointRef,
} from "@geometry/connectivity";
import { hitConnectionPoint, hitItem, hitWall } from "@geometry/hit";
import {
  MIN_OPENING_WIDTH,
  openingPlacementFromOffsets,
} from "@geometry/opening";
import { pointInRect, rectFrom, segmentIntersectsRect } from "@geometry/rect";
import { applyInverseViewTransform, snapToGrid } from "@geometry/snap";
import {
  findNearestWall,
  getPointOnWall,
  getWallAngle,
  getWallLength,
  MIN_WALL_LENGTH,
} from "@geometry/wall";
import clsx from "clsx";
import type React from "react";
import { useEffect, useRef, useState } from "react";
import { ConnectionPointsLayer } from "./ConnectionPointsLayer";
import { DimensionsLayer } from "./DimensionsLayer";
import styles from "./FloorPlan.module.css";
import { GridLayer } from "./GridLayer";
import { ItemsLayer } from "./ItemsLayer";
import { MarqueeLayer } from "./MarqueeLayer";
import { SelectionLayer } from "./SelectionLayer";
import { WallEndpointsLayer } from "./WallEndpointsLayer";
import { WallsLayer } from "./WallsLayer";

function uid(prefix = "id") {
  return `${prefix}_${Math.random().toString(36).slice(2, 9)}`;
}

type Opening = {
  type: "window" | "door";
  wallId: string;
  startOffset: number;
  currentOffset: number;
  thickness: number;
};

export function FloorPlan() {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const addWall = useApp((s) => s.addWall);
  const addItem = useApp((s) => s.addItem);
  const plan = useApp((s) => s.plan);
  const tool = useApp((s) => s.tool);
  const view = useApp((s) => s.view);
  const setView = useApp((s) => s.setView);
  const isPanning = useApp((s) => s.isPanning);
  const setIsPanning = useApp((s) => s.setIsPanning);
  const selectedWalls = useApp((s) => s.selectedWalls);
  const selectWall = useApp((s) => s.selectWall);
  const selectItem = useApp((s) => s.selectItem);
  const selectConnectionPoint = useApp((s) => s.selectConnectionPoint);
  const selectNone = useApp((s) => s.selectNone);
  const marquee = useApp((s) => s.marquee);
  const setMarquee = useApp((s) => s.setMarquee);
  const canvasSize = useApp((s) => s.canvasSize);

  const [drawingWall, setDrawingWall] = useState<Point | null>(null);
  const [cursor, setCursor] = useState<Point | null>(null);
  const [opening, setOpening] = useState<Opening | null>(null);
  const [dragging, setDragging] = useState<boolean>(false);
  const [moving, setMoving] = useState<null | {
    start: Point; // where drag began
    last: Point; // last applied position
    snap: boolean; // snap-to-grid on this drag
  }>(null);
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

    const nudgeWalls = useApp.getState().translateSelectedWalls;
    const nudgeConnectionPoint =
      useApp.getState().translateSelectedConnectionPoint;

    const onKey = (e: KeyboardEvent) => {
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
          setDrawingWall(null);
          setOpening(null);
          setDragging(false);
          setMoving(null);
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
          if (useApp.getState().selectedConnectionPoint) {
            nudgeConnectionPoint(0, -base * step);
          } else {
            nudgeWalls(0, -base * step);
          }
          break;
        case "arrowdown":
          if (useApp.getState().selectedConnectionPoint) {
            nudgeConnectionPoint(0, base * step);
          } else {
            nudgeWalls(0, base * step);
          }
          break;
        case "arrowleft":
          if (useApp.getState().selectedConnectionPoint) {
            nudgeConnectionPoint(-base * step, 0);
          } else {
            nudgeWalls(-base * step, 0);
          }
          break;
        case "arrowright":
          if (useApp.getState().selectedConnectionPoint) {
            nudgeConnectionPoint(base * step, 0);
          } else {
            nudgeWalls(base * step, 0);
          }
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

  const onPointerDown: React.PointerEventHandler<SVGSVGElement> = (e) => {
    if (!svgRef.current) return;
    // Capture on the <svg> itself (currentTarget), not e.target — a clicked
    // child (e.g. a wall <polygon>) can re-render mid-drag and drop the capture.
    e.currentTarget.setPointerCapture(e.pointerId);

    if (e.button === 2 || tool === "pan") {
      setIsPanning(true);
      return;
    }

    const world = toWorld(e.clientX, e.clientY);
    const additive = e.shiftKey;

    if (tool === "select") {
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
          setMovingEndpoint({
            ref: { wallId: selWall.id, end },
            startCoord: selWall[end],
            grabWorld: world,
            snap: !e.altKey,
          });
          useApp.getState().beginLiveDrag();
          return;
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
        setMoving({
          start: world,
          last: world,
          snap: !e.altKey,
        });
        useApp.getState().beginLiveDrag();
        if (!selectedWalls.has(hitW.id)) selectWall(hitW.id, additive);
        return;
      }

      // Start marquee if clicking on empty space
      setMarquee({ x0: world.x, y0: world.y, x1: world.x, y1: world.y });

      // empty: clear if not additive
      if (!additive) selectNone();
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
    const world = toWorld(e.clientX, e.clientY);
    setCursor(world);
    if (marquee) {
      setMarquee({ ...marquee, x1: world.x, y1: world.y });
      return;
    }
    if (isPanning) {
      setView((v) => ({
        ...v,
        panX: v.panX + e.movementX,
        panY: v.panY + e.movementY,
      }));
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
      let tx =
        movingEndpoint.startCoord.x + (world.x - movingEndpoint.grabWorld.x);
      let ty =
        movingEndpoint.startCoord.y + (world.y - movingEndpoint.grabWorld.y);
      if (movingEndpoint.snap) {
        const grid = plan.meta.gridSize;
        tx = Math.round(tx / grid) * grid;
        ty = Math.round(ty / grid) * grid;
      }
      useApp
        .getState()
        .moveWallEndpointLive(movingEndpoint.ref, { x: tx, y: ty });
      return;
    }

    // start moving a connection point
    if (e.buttons === 1 && tool === "select" && movingPoint) {
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

        useApp.getState().translateSelectedConnectionPointLive(tdx, tdy);
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

    // start moving wall
    if (e.buttons === 1 && tool === "select" && moving) {
      const world = toWorld(e.clientX, e.clientY);
      const dx = world.x - moving.last.x;
      const dy = world.y - moving.last.y;

      if (dx !== 0 || dy !== 0) {
        let tdx = dx,
          tdy = dy;

        if (moving.snap) {
          const grid = plan.meta.gridSize;
          // accumulate drag in world, then snap delta in grid quanta
          // We snap relative to start to prevent drift
          const totalDx = world.x - moving.start.x;
          const totalDy = world.y - moving.start.y;
          const snappedDx = Math.round(totalDx / grid) * grid;
          const snappedDy = Math.round(totalDy / grid) * grid;
          tdx = snappedDx - (moving.last.x - moving.start.x);
          tdy = snappedDy - (moving.last.y - moving.start.y);
        }

        useApp.getState().translateSelectedWallsLive(tdx, tdy);
        setMoving({
          ...moving,
          last: {
            x: moving.last.x + tdx,
            y: moving.last.y + tdy,
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

  const onPointerUp: React.PointerEventHandler<SVGSVGElement> = (e) => {
    if (!svgRef.current) return;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    if (isPanning) setIsPanning(false);
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
      const r = rectFrom(marquee.x0, marquee.y0, marquee.x1, marquee.y1);
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
      setMarquee(null);
      return;
    }
    if (moving) {
      // The drag updated the plan live (no history writes); commit it as a
      // single undo step, but only if the walls actually moved.
      const moved =
        moving.last.x !== moving.start.x || moving.last.y !== moving.start.y;
      // `commitPlan` clears the pre-drag snapshot; a no-op drag never committed,
      // so clear it explicitly to avoid a stale snapshot leaking into the next.
      if (moved) useApp.getState().commitPlan();
      else useApp.getState().endLiveDrag();
      setMoving(null);
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

  const onWheel: React.WheelEventHandler<SVGSVGElement> = (e) => {
    const delta = -e.deltaY;
    const factor = Math.exp(delta * 0.001);
    const worldBefore = toWorld(e.clientX, e.clientY);
    setView((v) => {
      const newScale = clampScale(v.scale * factor);
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
          moving && styles.moving,
          tool === "select" && !moving && styles.select,
        )}
        ref={svgRef}
        onContextMenu={(e) => e.preventDefault()}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onWheel={onWheel}
      >
        <title>Floor plan canvas</title>
        <g transform={viewTransform}>
          <GridLayer width={canvasSize.width} height={canvasSize.height} />
          <WallsLayer />
          <ItemsLayer />
          <DimensionsLayer />
          <SelectionLayer />
          <ConnectionPointsLayer />
          <WallEndpointsLayer />
          <MarqueeLayer />
          {wallPreview}
          {openingPreview}
        </g>
      </svg>
      <div className={styles.badge}>
        Tool: {tool} • Scale: {view.scale.toFixed(2)} • Pan: (
        {view.panX.toFixed(0)}, {view.panY.toFixed(0)})
      </div>
    </>
  );
}
