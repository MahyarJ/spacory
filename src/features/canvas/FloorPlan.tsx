import React, { useEffect, useRef, useState } from "react";
import { useApp } from "@app/store";
import { assertNever, type Point, type Wall } from "@app/schema";
import { snapToGrid, applyInverseViewTransform } from "@geometry/snap";
import { hitItem, hitWall } from "@geometry/hit";
import { findNearestWall, getPointOnWall, getWallAngle } from "@geometry/wall";
import { rectFrom, pointInRect, segmentIntersectsRect } from "@geometry/rect";
import { WallsLayer } from "./WallsLayer";
import { GridLayer } from "./GridLayer";
import { ItemsLayer } from "./ItemsLayer";
import { SelectionLayer } from "./SelectionLayer";
import { NodeCapsLayer } from "./NodeCapsLayer";
import { MarqueeLayer } from "./MarqueeLayer";
import styles from "./FloorPlan.module.css";

function uid(prefix = "id") {
  return prefix + "_" + Math.random().toString(36).slice(2, 9);
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
  const selectWall = useApp((s) => s.selectWall);
  const selectItem = useApp((s) => s.selectItem);
  const selectNone = useApp((s) => s.selectNone);
  const marquee = useApp((s) => s.marquee);
  const setMarquee = useApp((s) => s.setMarquee);

  const [drawingWall, setDrawingWall] = useState<Point | null>(null);
  const [cursor, setCursor] = useState<Point | null>(null);
  const [size, setSize] = useState<{ w: number; h: number }>({
    w: 800,
    h: 600,
  });
  const [opening, setOpening] = useState<Opening | null>(null);
  const [dragging, setDragging] = useState<boolean>(false);

  useEffect(() => {
    const resize = () => {
      const el = svgRef.current;
      if (!el) return;
      setSize({ w: el.clientWidth, h: el.clientHeight });
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

    const onKey = (e: KeyboardEvent) => {
      switch (e.key.toLocaleLowerCase()) {
        case "escape":
          setDrawingWall(null);
          setOpening(null);
          setDragging(false);
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
      }
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
      view.scale
    );
  };

  const onPointerDown: React.PointerEventHandler<SVGSVGElement> = (e) => {
    if (!svgRef.current) return;
    (e.target as Element).setPointerCapture(e.pointerId);

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

      // then walls
      const hitW = [...plan.walls].findLast((w) => hitWall(world, w, 6));
      if (hitW) {
        selectWall(hitW.id, additive);
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
        addWall(w);
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
        // finalize
        if (opening.wallId !== near.wall.id) return; // force same wall for now
        const endOffset =
          Math.round(near.offset / plan.meta.gridSize) * plan.meta.gridSize;
        const offset = Math.min(opening.startOffset, endOffset);
        const length = Math.max(5, Math.abs(endOffset - opening.startOffset)); // min 5cm width
        switch (opening.type) {
          case "window":
            addItem({
              id: uid(opening.type),
              type: opening.type,
              wallAttach: { wallId: opening.wallId, offset, length },
              thickness: opening.thickness,
              props: {},
            });
            break;
          case "door":
            addItem({
              id: uid(opening.type),
              type: opening.type,
              wallAttach: { wallId: opening.wallId, offset, length },
              thickness: opening.thickness,
              props: { hingeEdge: "start", swingSide: "outside" },
            });
            break;
          default:
            assertNever(opening as never); // TS forces to handle new kinds later
        }
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

    // start dragging wall
    if (e.buttons === 1 && tool === "wall") {
      setDragging(true);
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
    (e.target as Element).releasePointerCapture(e.pointerId);
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
      addWall(w);
      setDrawingWall(null);
      setDragging(false);
    }
    if (marquee) {
      const r = rectFrom(marquee.x0, marquee.y0, marquee.x1, marquee.y1);
      // select items
      for (const item of plan.items) {
        const wall = plan.walls.find((w) => w.id === item.wallAttach.wallId);
        if (!wall) continue;
        const mid = item.wallAttach.offset + item.wallAttach.length / 2;
        const cx =
          wall.a.x +
          (wall.b.x - wall.a.x) *
            (mid / Math.hypot(wall.b.x - wall.a.x, wall.b.y - wall.a.y));
        const cy =
          wall.a.y +
          (wall.b.y - wall.a.y) *
            (mid / Math.hypot(wall.b.x - wall.a.x, wall.b.y - wall.a.y));
        if (pointInRect({ x: cx, y: cy }, r)) selectItem(item.id, true);
      }
      // select walls
      for (const wall of plan.walls) {
        if (segmentIntersectsRect(wall.a, wall.b, r)) selectWall(wall.id, true);
      }
      setMarquee(null);
      return;
    }
  };

  const onWheel: React.WheelEventHandler<SVGSVGElement> = (e) => {
    const delta = -e.deltaY;
    const factor = Math.exp(delta * 0.001);
    const worldBefore = toWorld(e.clientX, e.clientY);
    setView((v) => {
      const newScale = Math.min(8, Math.max(0.2, v.scale * factor));
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
        className={styles.floorplan}
        ref={svgRef}
        onContextMenu={(e) => e.preventDefault()}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onWheel={onWheel}
      >
        <g transform={viewTransform}>
          <GridLayer width={size.w} height={size.h} />
          <WallsLayer />
          <NodeCapsLayer />
          <ItemsLayer />
          <SelectionLayer />
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
