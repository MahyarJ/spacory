import React, { useEffect, useRef, useState } from "react";
import { useApp } from "@app/store";
import type { Item, Point, Wall } from "@app/schema";
import { snapToGrid, applyInverseViewTransform } from "@geometry/snap";
import { WallsLayer } from "./WallsLayer";
import { GridLayer } from "./GridLayer";

import styles from "./FloorPlan.module.css";
import { findNearestWall, getPointOnWall, getWallAngle } from "@geometry/wall";
import { ItemsLayer } from "./ItemsLayer";

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

  const [drawingWall, setDrawingWall] = useState<Point | null>(null);
  const [cursor, setCursor] = useState<Point | null>(null);
  const [size, setSize] = useState<{ w: number; h: number }>({
    w: 800,
    h: 600,
  });
  const [opening, setOpening] = useState<Opening | null>(null);

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

    if (tool === "wall") {
      const snapped = snapToGrid(world, plan.meta.gridSize);
      if (!drawingWall) setDrawingWall(snapped);
      else {
        const w: Wall = {
          id: uid("wall"),
          a: drawingWall,
          b: snapped,
          thickness: useApp.getState().currentWallThickness,
        };
        addWall(w);
        setDrawingWall(null);
      }
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
        const item: Item = {
          id: uid(opening.type),
          type: opening.type,
          wallAttach: { wallId: opening.wallId, offset, length },
          thickness: opening.thickness,
        };
        addItem(item);
        setOpening(null);
      }
      return;
    }
  };

  const onPointerMove: React.PointerEventHandler<SVGSVGElement> = (e) => {
    if (!svgRef.current) return;
    const world = toWorld(e.clientX, e.clientY);
    setCursor(world);

    if (isPanning) {
      setView((v) => ({
        ...v,
        panX: v.panX + e.movementX,
        panY: v.panY + e.movementY,
      }));
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
          <ItemsLayer />
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
